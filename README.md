# Quicklook Phase 1

Quicklook is a Phase 1 ASIC quick look system with three components:

- **Simulator** (`simulator/`): C TCP server that emits realistic NDJSON event streams.
- **Backend** (`backend/`): FastAPI service that aggregates events into ~10s windows and exposes HTTP APIs.
- **Frontend** (`frontend/`): React dashboard that visualizes counts, histograms, and a rate heatmap while allowing Start/Stop control.

## Quickstart

1) **Build/run the simulator**

```bash
gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c
./simulator/simulator --port 9001 --channels 8 --rate-hz 400
```

2) **Run the backend**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
```

3) **Run the frontend**

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open http://localhost:5173 and use Start/Stop.

## Documentation

See the `docs/` folder for architecture, data contract, UX specs, and runbook.

## CI

The `.gitlab-ci.yml` builds the simulator, checks backend imports, and builds the frontend.
