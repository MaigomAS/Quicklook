#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${QUICKLOOK_BASE_URL:-http://localhost:8000}
REPLAY_PATH=${QUICKLOOK_REPLAY_PATH:-recordings/quicklook.ndjson}
REPLAY_SPEED=${QUICKLOOK_REPLAY_SPEED:-1.0}

if [[ ! -f "$REPLAY_PATH" ]]; then
  echo "Replay file not found: $REPLAY_PATH" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

QUICKLOOK_MODE=replay QUICKLOOK_REPLAY_PATH="$REPLAY_PATH" QUICKLOOK_REPLAY_SPEED="$REPLAY_SPEED" \
  uvicorn backend.src.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

python tools/monitor/quicklook_tui.py --base-url "$BASE_URL"
