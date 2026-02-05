# Quicklook Phase 1

Quicklook is a Phase 1 ASIC quick look system with three components:

- **Simulator** (`simulator/`): C TCP server that emits realistic NDJSON event streams.
- **Backend** (`backend/`): FastAPI service that aggregates events into ~10s windows and exposes HTTP APIs.
- **Frontend** (`frontend/`): React dashboard that visualizes counts, histograms, and a rate heatmap while allowing Start/Stop control.

## Quickstart

1) **Build/run the simulator**

```bash
gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c simulator/src/jsmn.c
./simulator/simulator --port 9001 --channels 8 --rate-hz 400
```

2) **Run the backend (live mode)**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
QUICKLOOK_MODE=live uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

3) **Run the terminal monitor**

```bash
python tools/monitor/quicklook_tui.py --base-url http://localhost:8000
```

4) **Run the frontend**

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open http://localhost:5173 and use Start/Stop.

## Record/Replay Modes

- **Record**: connect to the simulator and append NDJSON to a file.
- **Replay**: read NDJSON from a file at a real-time-ish pace.

```bash
QUICKLOOK_MODE=record QUICKLOOK_RECORD_PATH=recordings/quicklook.ndjson \
  uvicorn backend.src.main:app --host 0.0.0.0 --port 8000

QUICKLOOK_MODE=replay QUICKLOOK_REPLAY_PATH=recordings/quicklook.ndjson QUICKLOOK_REPLAY_SPEED=2.0 \
  uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

## How to Verify

1) **Start the simulator**

```bash
./simulator/simulator --port 9001 --channels 8 --rate-hz 400
```

2) **Start the backend in live mode**

```bash
QUICKLOOK_MODE=live uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

3) **Use the monitor to start acquisition and observe stats**

```bash
python tools/monitor/quicklook_tui.py --base-url http://localhost:8000
```

4) **Record events to a file**

```bash
QUICKLOOK_MODE=record QUICKLOOK_RECORD_PATH=recordings/quicklook.ndjson \
  uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

5) **Replay events without the simulator**

```bash
QUICKLOOK_MODE=replay QUICKLOOK_REPLAY_PATH=recordings/quicklook.ndjson \
  uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

## Documentation

See the `docs/` folder for architecture, data contract, UX specs, and runbook.

## CI

The `.gitlab-ci.yml` builds the simulator, checks backend imports, and builds the frontend.
