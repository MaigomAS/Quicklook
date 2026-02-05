#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${QUICKLOOK_BASE_URL:-http://localhost:8000}
RECORD_PATH=${QUICKLOOK_RECORD_PATH:-recordings/quicklook.ndjson}

mkdir -p "$(dirname "$RECORD_PATH")"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

QUICKLOOK_MODE=record QUICKLOOK_RECORD_PATH="$RECORD_PATH" \
  uvicorn backend.src.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

python tools/monitor/quicklook_tui.py --base-url "$BASE_URL"
