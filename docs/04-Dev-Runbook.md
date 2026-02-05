# Development Runbook

## Prerequisites

- GCC (C11)
- Python 3.11+
- Node.js 18+

## Local Run

### 1) Simulator

```bash
gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c simulator/src/jsmn.c
./simulator/simulator --port 9001 --channels 8 --rate-hz 400
```

Optional flags:

- `--config <path>` JSON config with `channels`, `dead_channels`, `rate_multipliers`, and `distribution`.
- `--burst-mode <on|off>` to periodically boost a subset of channels.
- `--drop-rate <0..1>` to randomly drop events.
- `--stats-interval <seconds>` to emit runtime stats.

### 2) Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
QUICKLOOK_MODE=live uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

Modes:

- `QUICKLOOK_MODE=live` (default): connect to the simulator.
- `QUICKLOOK_MODE=record`: connect to the simulator and append NDJSON to `QUICKLOOK_RECORD_PATH`.
- `QUICKLOOK_MODE=replay`: read NDJSON from `QUICKLOOK_REPLAY_PATH` at `QUICKLOOK_REPLAY_SPEED`.

### 3) Terminal Monitor

```bash
python tools/monitor/quicklook_tui.py --base-url http://localhost:8000
```

### 4) Frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

## End-to-End Check

- Run simulator
- Run backend (`QUICKLOOK_MODE=live`)
- Run terminal monitor, press `s` to start acquisition
- Watch counts and histograms update every ~10 seconds
- Press `t` to stop acquisition

## Convenience Scripts

```bash
./tools/scripts/run_live.sh
./tools/scripts/run_record.sh
./tools/scripts/run_replay.sh
```

## Configurations

- Backend environment variables:
  - `SIM_HOST` (default `127.0.0.1`)
  - `SIM_PORT` (default `9001`)
  - `WINDOW_S` (default `10`)
  - `CHANNELS` (default `4`)
  - `CORS_ORIGINS` (comma-separated)
  - `QUICKLOOK_MODE` (`live`, `record`, `replay`)
  - `QUICKLOOK_RECORD_PATH` (recording output file)
  - `QUICKLOOK_REPLAY_PATH` (recording input file)
  - `QUICKLOOK_REPLAY_SPEED` (float, default `1.0`)

- Simulator config JSON example:

```json
{
  "channels": 8,
  "dead_channels": [2],
  "rate_multipliers": [1.0, 0.7, 0.0, 1.4, 1.2, 1.0, 0.9, 0.8],
  "distribution": {
    "g_mean": 2500.0,
    "g_std": 260.0,
    "x_mean": 1700.0,
    "x_std": 200.0,
    "g_event_prob": 0.4
  }
}
```
