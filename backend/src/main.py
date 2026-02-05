from __future__ import annotations

import json
import os
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@dataclass
class AggregationWindow:
    window_s: int
    t_start_us: int = 0
    t_end_us: int = 0
    counts_by_channel: Dict[int, int] = field(default_factory=dict)
    hist_adc_x: Dict[int, List[int]] = field(default_factory=dict)
    hist_adc_gtop: Dict[int, List[int]] = field(default_factory=dict)
    hist_adc_gbot: Dict[int, List[int]] = field(default_factory=dict)
    notes: List[str] = field(default_factory=list)

    def reset(self) -> None:
        self.t_start_us = 0
        self.t_end_us = 0
        self.counts_by_channel.clear()
        self.hist_adc_x.clear()
        self.hist_adc_gtop.clear()
        self.hist_adc_gbot.clear()
        self.notes.clear()


@dataclass
class AcquisitionState:
    sim_host: str
    sim_port: int
    window_s: int
    channels: int
    mode: str
    record_path: Optional[str]
    replay_path: Optional[str]
    replay_speed: float
    running: bool = False
    connected: bool = False
    last_error: Optional[str] = None
    latest_snapshot: Optional[dict] = None
    thread: Optional[threading.Thread] = None
    stop_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    window: AggregationWindow = field(init=False)

    def __post_init__(self) -> None:
        self.window = AggregationWindow(window_s=self.window_s)


MODE_LIVE = "live"
MODE_RECORD = "record"
MODE_REPLAY = "replay"


def adc_to_bin(adc: int) -> int:
    adc = max(0, min(4095, adc))
    return min(63, adc // 64)


def empty_snapshot(window_s: int) -> dict:
    return {
        "window_s": window_s,
        "t_start_us": 0,
        "t_end_us": 0,
        "channels": [],
        "counts_by_channel": {},
        "histograms": {"adc_x": {}, "adc_gtop": {}, "adc_gbot": {}},
        "ratemap_8x8": [[0.0 for _ in range(8)] for _ in range(8)],
        "notes": ["no data yet"],
    }


def build_snapshot(window: AggregationWindow) -> dict:
    channels = sorted(window.counts_by_channel.keys())
    counts_by_channel = {str(k): v for k, v in window.counts_by_channel.items()}

    ratemap = [[0.0 for _ in range(8)] for _ in range(8)]
    for ch, count in window.counts_by_channel.items():
        row = ch // 8
        col = ch % 8
        if row < 8 and col < 8:
            ratemap[row][col] = count / float(window.window_s)

    histograms = {
        "adc_x": {str(k): v for k, v in window.hist_adc_x.items()},
        "adc_gtop": {str(k): v for k, v in window.hist_adc_gtop.items()},
        "adc_gbot": {str(k): v for k, v in window.hist_adc_gbot.items()},
    }

    return {
        "window_s": window.window_s,
        "t_start_us": window.t_start_us,
        "t_end_us": window.t_end_us,
        "channels": channels,
        "counts_by_channel": counts_by_channel,
        "histograms": histograms,
        "ratemap_8x8": ratemap,
        "notes": window.notes,
    }


def ensure_hist(hist_map: Dict[int, List[int]], channel: int) -> List[int]:
    if channel not in hist_map:
        hist_map[channel] = [0 for _ in range(64)]
    return hist_map[channel]


def process_event(state: AcquisitionState, event: dict) -> None:
    t_us = int(event.get("t_us", 0))
    channel = int(event.get("channel", -1))
    adc_x = int(event.get("adc_x", 0))
    adc_gtop = int(event.get("adc_gtop", 0))
    adc_gbot = int(event.get("adc_gbot", 0))

    with state.lock:
        if state.window.t_start_us == 0:
            state.window.t_start_us = t_us
        state.window.t_end_us = t_us
        state.window.counts_by_channel[channel] = state.window.counts_by_channel.get(channel, 0) + 1

        ensure_hist(state.window.hist_adc_x, channel)[adc_to_bin(adc_x)] += 1
        ensure_hist(state.window.hist_adc_gtop, channel)[adc_to_bin(adc_gtop)] += 1
        ensure_hist(state.window.hist_adc_gbot, channel)[adc_to_bin(adc_gbot)] += 1

        if state.window.t_end_us - state.window.t_start_us >= state.window.window_s * 1_000_000:
            state.latest_snapshot = build_snapshot(state.window)
            state.window.reset()


def run_live(state: AcquisitionState, record_fp: Optional[object]) -> None:
    with socket.create_connection((state.sim_host, state.sim_port), timeout=5) as sock:
        state.connected = True
        sock_file = sock.makefile("r")
        for line in sock_file:
            if state.stop_event.is_set():
                break
            line = line.strip()
            if not line:
                continue
            if record_fp:
                record_fp.write(line + "\n")
                record_fp.flush()
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                state.last_error = "invalid json"
                continue
            process_event(state, event)


def run_replay(state: AcquisitionState) -> None:
    if not state.replay_path:
        state.last_error = "replay path not set"
        return
    with open(state.replay_path, "r", encoding="utf-8") as replay_fp:
        state.connected = True
        last_t_us: Optional[int] = None
        for line in replay_fp:
            if state.stop_event.is_set():
                break
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                state.last_error = "invalid json"
                continue
            t_us = int(event.get("t_us", 0))
            if last_t_us is not None:
                delta_us = max(0, t_us - last_t_us)
                sleep_s = (delta_us / 1_000_000.0) / max(state.replay_speed, 0.01)
                if sleep_s > 0:
                    time.sleep(sleep_s)
            last_t_us = t_us
            process_event(state, event)


def run_acquisition(state: AcquisitionState) -> None:
    state.stop_event.clear()
    state.last_error = None
    state.window.reset()
    try:
        if state.mode == MODE_REPLAY:
            run_replay(state)
        else:
            record_fp = None
            if state.mode == MODE_RECORD:
                if not state.record_path:
                    state.last_error = "record path not set"
                    return
                record_fp = open(state.record_path, "a", encoding="utf-8")
            try:
                run_live(state, record_fp)
            finally:
                if record_fp:
                    record_fp.close()
    except OSError as exc:
        state.last_error = str(exc)
    finally:
        state.connected = False
        with state.lock:
            if state.window.t_start_us != 0:
                state.latest_snapshot = build_snapshot(state.window)
            state.window.reset()
        state.running = False


app = FastAPI()

cors_origins = os.getenv("CORS_ORIGINS", "*")
origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
if not origins:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state = AcquisitionState(
    sim_host=os.getenv("SIM_HOST", "127.0.0.1"),
    sim_port=int(os.getenv("SIM_PORT", "9001")),
    window_s=int(os.getenv("WINDOW_S", "10")),
    channels=int(os.getenv("CHANNELS", "4")),
    mode=os.getenv("QUICKLOOK_MODE", MODE_LIVE),
    record_path=os.getenv("QUICKLOOK_RECORD_PATH"),
    replay_path=os.getenv("QUICKLOOK_REPLAY_PATH"),
    replay_speed=float(os.getenv("QUICKLOOK_REPLAY_SPEED", "1.0")),
)


@app.post("/start")
def start_acquisition() -> dict:
    if state.running:
        return {"running": True, "connected": state.connected}
    state.running = True
    state.thread = threading.Thread(target=run_acquisition, args=(state,), daemon=True)
    state.thread.start()
    return {"running": True, "connected": state.connected}


@app.post("/stop")
def stop_acquisition() -> dict:
    if not state.running:
        return {"running": False, "connected": state.connected}
    state.stop_event.set()
    if state.thread and state.thread.is_alive():
        state.thread.join(timeout=2)
    state.running = False
    return {"running": False, "connected": state.connected}


@app.get("/status")
def get_status() -> dict:
    return {
        "running": state.running,
        "connected": state.connected,
        "last_error": state.last_error,
        "mode": state.mode,
        "record_path": state.record_path,
        "replay_path": state.replay_path,
        "replay_speed": state.replay_speed,
    }


@app.get("/snapshot")
def get_snapshot() -> dict:
    with state.lock:
        if state.latest_snapshot:
            return state.latest_snapshot
    return empty_snapshot(state.window_s)


@app.get("/config")
def get_config() -> dict:
    return {
        "sim_host": state.sim_host,
        "sim_port": state.sim_port,
        "window_s": state.window_s,
        "channels": state.channels,
        "mode": state.mode,
        "record_path": state.record_path,
        "replay_path": state.replay_path,
        "replay_speed": state.replay_speed,
    }
