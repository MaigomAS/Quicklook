# Quicklook Terminal Monitor

A lightweight terminal dashboard for Quicklook that polls the backend APIs and renders counts + ratemap in ASCII.

## Requirements

- Python 3.8+
- No additional dependencies (stdlib only)

## Run

```bash
python tools/monitor/quicklook_tui.py --base-url http://localhost:8000
```

## Options

- `--base-url`: Backend base URL (default `http://localhost:8000` or `QUICKLOOK_BASE_URL`).
- `--status-interval`: Seconds between `/status` polls (default `2`).
- `--snapshot-interval`: Seconds between `/snapshot` polls (default `10`).
- `--no-input`: Disable keyboard controls (useful when stdin is not a TTY).

## Controls

- `s`: POST `/start` to begin acquisition.
- `t`: POST `/stop` to stop acquisition.
- `q`: Quit the monitor.

If keyboard controls are disabled, use curl:

```bash
curl -X POST http://localhost:8000/start
curl -X POST http://localhost:8000/stop
```
