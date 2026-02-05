# Backend

FastAPI service that connects to the simulator, aggregates events into ~10-second windows, and serves snapshots.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## Run

```bash
uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

## Environment Variables

- `SIM_HOST` (default `127.0.0.1`)
- `SIM_PORT` (default `9001`)
- `WINDOW_S` (default `10`)
- `CHANNELS` (default `4`)
- `CORS_ORIGINS` (comma-separated, default `*`)
