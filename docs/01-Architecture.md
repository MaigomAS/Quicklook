# Architecture

```
+-----------+       TCP (NDJSON)        +-----------+      HTTP (JSON)      +-----------+
| Simulator | ------------------------> |  Backend  | -------------------> | Frontend  |
+-----------+                           +-----------+                      +-----------+
```

## Simulator

- TCP server bound to configurable host/port.
- Accepts one client connection.
- Emits NDJSON event lines at a configurable total rate.
- Produces per-channel rate multipliers and realistic ADC distributions.

## Backend

- FastAPI server bound to `0.0.0.0` by default.
- `/start` connects to the simulator and begins a background reader thread.
- Reader parses NDJSON, aggregates into 10s windows, and stores the latest snapshot.
- `/snapshot` returns the most recent snapshot for the UI.
- `/status` reports acquisition state and connection status.

## Frontend

- Polls `/status` every ~2 seconds and `/snapshot` every ~10 seconds.
- Visualizes counts-by-channel, histogram mini-plots, and an 8x8 rate map.
- Start/Stop buttons call `/start` and `/stop`.

## Deployment Notes

- Backend should run near hardware for Phase 2. For Phase 1, it runs locally with the simulator.
- Frontend is remotely accessible (CORS enabled in backend).
