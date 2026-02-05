# Project Overview

Quicklook Phase 1 provides a realistic ASIC event simulator, a backend aggregator, and a remote-controlled frontend dashboard.

## Goals

- Simulate multi-channel ASIC events with realistic per-channel rates and ADC distributions.
- Aggregate events in ~10-second windows and publish snapshots to a web UI.
- Provide a remotely accessible dashboard with Start/Stop control and health indicators.

## Components

- **simulator/**: C TCP server emitting NDJSON events (one JSON object per line).
- **backend/**: FastAPI server reading the TCP stream and producing snapshots via HTTP.
- **frontend/**: React + Vite UI polling the backend and visualizing results.

## Phase 1 Scope

- Single backend client connection to the simulator.
- Simple snapshot aggregation: counts, histograms, and an 8x8 rate map.
- Polling-based UI updates (optional WebSocket can be added later).
