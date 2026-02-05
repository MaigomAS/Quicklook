# Development Runbook

## Prerequisites

- GCC (C11)
- Python 3.11+
- Node.js 18+

## Local Run

### 1) Simulator

```bash
gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c
./simulator/simulator --port 9001 --channels 8 --rate-hz 400
```

### 2) Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

### 3) Frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

## End-to-End Check

- Open http://localhost:5173
- Click Start
- Watch counts and histograms update every ~10 seconds
- Click Stop to freeze the snapshot

## Configurations

- Backend environment variables:
  - `SIM_HOST` (default `127.0.0.1`)
  - `SIM_PORT` (default `9001`)
  - `WINDOW_S` (default `10`)
  - `CHANNELS` (default `4`)
  - `CORS_ORIGINS` (comma-separated)
