#!/usr/bin/env python3
"""Quicklook hardware adapter: binary lab stream -> NDJSON events."""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

SUBRECORD_SIZE = 12
RECORD_SIZE = 24
PPS_TICKS = 10_000_000


@dataclass
class DecoderState:
    last_unwrapped_ticks: Optional[int] = None
    wrap_offset_ticks: int = 0


class ChannelMapper:
    def __init__(self, mapping_path: Optional[Path] = None) -> None:
        self._raw_to_channel: Dict[int, int] = {}
        self._next_channel = 0
        if mapping_path:
            self._load_mapping(mapping_path)

    def _load_mapping(self, mapping_path: Path) -> None:
        payload = json.loads(mapping_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("mapping file must be a JSON object")
        for raw_id_text, channel_val in payload.items():
            raw_id = int(raw_id_text)
            channel = int(channel_val)
            if channel < 0 or channel > 63:
                raise ValueError(f"invalid channel {channel} for raw_id={raw_id}; expected 0..63")
            self._raw_to_channel[raw_id] = channel
            self._next_channel = max(self._next_channel, channel + 1)

    def map_raw_id(self, raw_id: int) -> Optional[int]:
        if raw_id in self._raw_to_channel:
            return self._raw_to_channel[raw_id]
        if self._next_channel >= 64:
            return None
        channel = self._next_channel
        self._raw_to_channel[raw_id] = channel
        self._next_channel += 1
        print(f"[adapter] auto-mapped raw_id={raw_id} -> channel={channel}", file=sys.stderr, flush=True)
        return channel

    def describe(self) -> str:
        if not self._raw_to_channel:
            return "<empty>"
        ordered = sorted(self._raw_to_channel.items(), key=lambda item: item[1])
        return ", ".join(f"{raw}:{ch}" for raw, ch in ordered)


class OutputFanout:
    def __init__(self, emit_stdout: bool, tcp_server: Optional[Tuple[str, int]], tcp_client: Optional[Tuple[str, int]]) -> None:
        self.emit_stdout = emit_stdout
        self.server_socket: Optional[socket.socket] = None
        self.server_clients: List[socket.socket] = []
        self.client_target = tcp_client
        self.client_socket: Optional[socket.socket] = None
        self.client_last_retry_s = 0.0

        if tcp_server:
            host, port = tcp_server
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind((host, port))
            srv.listen()
            srv.setblocking(False)
            self.server_socket = srv
            print(f"[adapter] TCP server listening on {host}:{port}", file=sys.stderr)

        if tcp_client:
            host, port = tcp_client
            print(f"[adapter] TCP client target {host}:{port}", file=sys.stderr)

    def _accept_server_clients(self) -> None:
        if not self.server_socket:
            return
        while True:
            try:
                conn, addr = self.server_socket.accept()
            except BlockingIOError:
                return
            conn.setblocking(False)
            self.server_clients.append(conn)
            print(f"[adapter] TCP server client connected: {addr[0]}:{addr[1]}", file=sys.stderr)

    def _ensure_client_connected(self) -> None:
        if not self.client_target or self.client_socket:
            return
        now = time.monotonic()
        if now - self.client_last_retry_s < 1.0:
            return
        self.client_last_retry_s = now
        host, port = self.client_target
        try:
            sock = socket.create_connection((host, port), timeout=2.0)
            sock.setblocking(False)
            self.client_socket = sock
            print(f"[adapter] TCP client connected to {host}:{port}", file=sys.stderr)
        except OSError:
            return

    def emit(self, line: bytes) -> None:
        self._accept_server_clients()
        self._ensure_client_connected()

        if self.emit_stdout:
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()

        if self.server_clients:
            keep: List[socket.socket] = []
            for conn in self.server_clients:
                try:
                    conn.sendall(line)
                    keep.append(conn)
                except OSError:
                    conn.close()
            self.server_clients = keep

        if self.client_socket:
            try:
                self.client_socket.sendall(line)
            except OSError:
                self.client_socket.close()
                self.client_socket = None

    def close(self) -> None:
        for conn in self.server_clients:
            conn.close()
        if self.server_socket:
            self.server_socket.close()
        if self.client_socket:
            self.client_socket.close()


def parse_host_port(value: str) -> Tuple[str, int]:
    host, sep, port_text = value.rpartition(":")
    if not sep:
        raise argparse.ArgumentTypeError("expected host:port")
    try:
        port = int(port_text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid port in '{value}'") from exc
    return host, port


def decode_word(word: int) -> dict:
    return {
        "no_data": bool((word >> 63) & 0x1),
        "adc_x": (word >> 51) & 0xFFF,
        "adc_gtop": (word >> 39) & 0xFFF,
        "adc_gbot": (word >> 27) & 0xFFF,
        "is_g_event": bool((word >> 26) & 0x1),
        "time_ticks": (word >> 2) & 0xFFFFFF,
        "trg_g": bool((word >> 1) & 0x1),
        "trg_x": bool(word & 0x1),
    }


def unwrap_ticks(time_ticks: int, state: DecoderState, unwrap_threshold_ticks: int) -> int:
    candidate = time_ticks + state.wrap_offset_ticks
    if state.last_unwrapped_ticks is not None:
        diff = state.last_unwrapped_ticks - candidate
        if diff > unwrap_threshold_ticks:
            state.wrap_offset_ticks += PPS_TICKS
            candidate = time_ticks + state.wrap_offset_ticks
    state.last_unwrapped_ticks = candidate
    return candidate


def iter_subrecords_from_binary(stream) -> Iterable[Tuple[int, int]]:
    buffer = bytearray()
    while True:
        chunk = stream.read(4096)
        if not chunk:
            break
        buffer.extend(chunk)
        whole = len(buffer) // SUBRECORD_SIZE
        upto = whole * SUBRECORD_SIZE
        for offset in range(0, upto, SUBRECORD_SIZE):
            raw_id, word = struct.unpack_from("<IQ", buffer, offset)
            yield raw_id, word
        del buffer[:upto]


def build_event(raw_id: int, word: int, mapper: ChannelMapper, state: DecoderState, unwrap_threshold_ticks: int) -> Optional[dict]:
    fields = decode_word(word)
    channel = mapper.map_raw_id(raw_id)
    if channel is None:
        print(f"[adapter] dropping raw_id={raw_id}: no free channels left in 0..63", file=sys.stderr)
        return None

    unwrapped_ticks = unwrap_ticks(fields["time_ticks"], state, unwrap_threshold_ticks)
    event = {
        "t_us": unwrapped_ticks // 10,
        "channel": channel,
        "adc_x": fields["adc_x"],
        "adc_gtop": fields["adc_gtop"],
        "adc_gbot": fields["adc_gbot"],
        "flags": {
            "trg_x": fields["trg_x"],
            "trg_g": fields["trg_g"],
            "no_data": fields["no_data"],
            "is_g_event": fields["is_g_event"],
        },
    }
    return event


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hardware adapter: lab binary stream to Quicklook NDJSON")
    parser.add_argument("--input", choices=["file", "stdin"], required=True)
    parser.add_argument("--file", type=Path, help="input file when --input file")
    parser.add_argument("--mapping", type=Path, help="optional raw_id->channel JSON mapping")
    parser.add_argument("--out", choices=["ndjson", "none"], default="ndjson", help="stdout output mode")
    parser.add_argument("--tcp-server", type=parse_host_port, help="serve NDJSON as TCP server host:port")
    parser.add_argument("--tcp-client", type=parse_host_port, help="push NDJSON to remote host:port")
    parser.add_argument(
        "--no-data",
        choices=["keep", "drop"],
        default="drop",
        help="handling policy for decoded flags.no_data events (default: drop)",
    )
    parser.add_argument(
        "--drop-no-data",
        action="store_true",
        help="equivalent to --no-data drop",
    )
    parser.add_argument(
        "--include-no-data",
        action="store_true",
        help="override policy and keep no_data events for debugging",
    )
    parser.add_argument(
        "--unwrap-threshold-ticks",
        type=int,
        default=1_000_000,
        help="backward jump threshold before applying +10,000,000 tick PPS unwrap",
    )
    return parser.parse_args()


def keep_no_data_events(args: argparse.Namespace) -> bool:
    if args.include_no_data:
        return True
    if args.drop_no_data:
        return False
    return args.no_data == "keep"


def main() -> int:
    args = parse_args()
    if args.input == "file" and not args.file:
        print("--file is required when --input file", file=sys.stderr)
        return 2

    mapper = ChannelMapper(mapping_path=args.mapping)
    print(f"[adapter] initial mapping: {mapper.describe()}", file=sys.stderr)

    fanout = OutputFanout(
        emit_stdout=args.out == "ndjson",
        tcp_server=args.tcp_server,
        tcp_client=args.tcp_client,
    )

    decode_state = DecoderState()
    emitted_total = 0
    emitted_hits = 0
    dropped_no_data = 0
    dropped_no_channel = 0
    keep_no_data = keep_no_data_events(args)
    print(f"[adapter] no_data policy: {'keep' if keep_no_data else 'drop'}", file=sys.stderr)

    try:
        source = open(args.file, "rb") if args.input == "file" else sys.stdin.buffer
        with source if args.input == "file" else nullcontext(source):
            for raw_id, word in iter_subrecords_from_binary(source):
                event = build_event(raw_id, word, mapper, decode_state, args.unwrap_threshold_ticks)
                if event is None:
                    dropped_no_channel += 1
                    continue
                if event["flags"]["no_data"] and not keep_no_data:
                    dropped_no_data += 1
                    continue
                line = (json.dumps(event, separators=(",", ":")) + "\n").encode("utf-8")
                fanout.emit(line)
                emitted_total += 1
                if not event["flags"]["no_data"]:
                    emitted_hits += 1
    finally:
        fanout.close()

    print(
        "[adapter] done. "
        f"emitted_hits={emitted_hits} "
        f"dropped_no_data={dropped_no_data} "
        f"emitted_total={emitted_total} "
        f"dropped_no_channel={dropped_no_channel}",
        file=sys.stderr,
    )
    print(f"[adapter] final mapping: {mapper.describe()}", file=sys.stderr)
    return 0


class nullcontext:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self.value

    def __exit__(self, exc_type, exc, tb):
        return False


if __name__ == "__main__":
    raise SystemExit(main())
