#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

try:
    import termios
    import tty
    import select
except ImportError:  # pragma: no cover
    termios = None
    tty = None
    select = None

BAR_CHARS = " .:-=+*#%@"


def http_get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def http_post(url: str) -> dict:
    req = urllib.request.Request(url, method="POST")
    with urllib.request.urlopen(req, timeout=5) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def clear_screen() -> None:
    sys.stdout.write("\x1b[2J\x1b[H")


def format_bar(value: float, max_value: float, width: int = 20) -> str:
    if max_value <= 0:
        return "".ljust(width)
    filled = int((value / max_value) * width)
    return "#" * filled + "-" * (width - filled)


def render_ratemap(ratemap: list[list[float]]) -> str:
    max_value = max((max(row) for row in ratemap), default=0.0)
    lines = []
    for row in ratemap:
        line_chars = []
        for value in row:
            if max_value <= 0:
                idx = 0
            else:
                idx = int((value / max_value) * (len(BAR_CHARS) - 1))
            line_chars.append(BAR_CHARS[idx])
        lines.append("".join(line_chars))
    return "\n".join(lines)


def render_counts(counts: dict[str, int]) -> str:
    if not counts:
        return "(no counts yet)"
    items = sorted(((int(k), v) for k, v in counts.items()), key=lambda x: x[0])
    max_value = max(v for _, v in items)
    lines = []
    for ch, value in items:
        bar = format_bar(value, max_value)
        lines.append(f"ch {ch:02d} | {bar} {value}")
    return "\n".join(lines)


def fetch_with_error(url: str) -> tuple[dict | None, str | None]:
    try:
        return http_get(url), None
    except urllib.error.URLError as exc:
        return None, f"{exc}"
    except json.JSONDecodeError as exc:
        return None, f"{exc}"


def print_dashboard(status: dict | None, snapshot: dict | None, error: str | None) -> None:
    clear_screen()
    print("Quicklook Terminal Monitor")
    print("=" * 30)
    if error:
        print(f"Error: {error}")
        print()
    if status:
        print(
            f"Mode: {status.get('mode', 'n/a')} | Running: {status.get('running')} | "
            f"Connected: {status.get('connected')} | Last error: {status.get('last_error')}"
        )
        print(
            f"Record path: {status.get('record_path')} | Replay path: {status.get('replay_path')} | "
            f"Replay speed: {status.get('replay_speed')}"
        )
    else:
        print("Status: unavailable")
    print()
    if snapshot:
        print(f"Window: {snapshot.get('t_start_us')} - {snapshot.get('t_end_us')} (us)")
        notes = snapshot.get("notes", [])
        if notes:
            print(f"Notes: {', '.join(notes)}")
        print()
        print("Counts by channel:")
        print(render_counts(snapshot.get("counts_by_channel", {})))
        print()
        print("Ratemap 8x8:")
        print(render_ratemap(snapshot.get("ratemap_8x8", [[0.0 for _ in range(8)] for _ in range(8)])))
    else:
        print("Snapshot: unavailable")
    print()
    print("Controls: s=start t=stop q=quit")


def read_keypress() -> str | None:
    if not sys.stdin.isatty() or termios is None or tty is None or select is None:
        return None
    if select.select([sys.stdin], [], [], 0)[0]:
        return sys.stdin.read(1)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Quicklook terminal monitor")
    parser.add_argument("--base-url", default=os.getenv("QUICKLOOK_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--status-interval", type=float, default=2.0)
    parser.add_argument("--snapshot-interval", type=float, default=10.0)
    parser.add_argument("--no-input", action="store_true", help="disable keyboard controls")
    args = parser.parse_args()

    status_url = f"{args.base_url}/status"
    snapshot_url = f"{args.base_url}/snapshot"

    last_status = 0.0
    last_snapshot = 0.0
    status = None
    snapshot = None
    error = None

    old_settings = None
    if not args.no_input and sys.stdin.isatty() and termios and tty:
        old_settings = termios.tcgetattr(sys.stdin)
        tty.setcbreak(sys.stdin.fileno())

    try:
        while True:
            now = time.time()
            if now - last_status >= args.status_interval:
                status, error = fetch_with_error(status_url)
                last_status = now
            if now - last_snapshot >= args.snapshot_interval:
                snapshot, error = fetch_with_error(snapshot_url)
                last_snapshot = now
            print_dashboard(status, snapshot, error)

            if not args.no_input:
                key = read_keypress()
                if key == "q":
                    break
                if key == "s":
                    try:
                        http_post(f"{args.base_url}/start")
                    except urllib.error.URLError:
                        error = "failed to start acquisition"
                if key == "t":
                    try:
                        http_post(f"{args.base_url}/stop")
                    except urllib.error.URLError:
                        error = "failed to stop acquisition"
            time.sleep(0.1)
    finally:
        if old_settings:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
