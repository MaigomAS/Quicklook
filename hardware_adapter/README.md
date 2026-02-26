# Hardware Adapter (Lab Binary -> Quicklook NDJSON)

This adapter converts the lab binary stream (`u32 raw_id + u64 word`, little-endian) into Quicklook-compatible NDJSON without changing backend snapshot semantics.

## Why Python

The adapter is implemented in Python for fast iteration, easy piping (`stdin`/`stdout`), and zero extra dependencies. It is fully compatible with replay/live workflows because it emits the same event contract the backend already consumes.

## Data format decoded

Each 12-byte subrecord is decoded as:

- `raw_id` (little-endian `u32`)
- `word` (little-endian `u64`)

`word` bit layout (ORION-BE MISO output):

- `bit63`: `no_data`
- `bits62:51`: `ADC_X`
- `bits50:39`: `ADC_GTOP`
- `bits38:27`: `ADC_GBOT`
- `bit26`: `is_g_event`
- `bits25:2`: `TIME` (24-bit ticks @ 10MHz, 100ns)
- `bit1`: `TRG_G`
- `bit0`: `TRG_X`

Timestamp unwrapping:

- If `TIME` goes backward more than `--unwrap-threshold-ticks` (default `1_000_000`), add `10_000_000` ticks (1 second) offset.
- Output timestamp is monotonic microseconds: `t_us = unwrapped_ticks // 10`.

## Channel mapping

Quicklook requires `channel` in `0..63`.

- **Default auto-detect**: first unseen `raw_id` -> channel 0, next -> 1, etc.
- **Optional explicit mapping file** (`--mapping mapping.json`):

```json
{
  "2": 0,
  "66": 2,
  "98": 3
}
```

The adapter logs initial/final mapping and each auto-assignment to `stderr`.

## `no_data` filtering (default: drop)

Real lab streams contain many poll responses with `flags.no_data=true`.

- Default behavior: drop `no_data=true` events before emitting NDJSON (stdout/TCP).
- Keep them for debugging with `--include-no-data` (or `--no-data keep`).

Exit summary always reports:

- `emitted_hits`: emitted events where `no_data=false`
- `dropped_no_data`: filtered `no_data=true` events
- `emitted_total`: total emitted events (includes no-data only when enabled)

## Build / Run (macOS + Linux)

No build step required (Python 3.9+).

```bash
chmod +x hardware_adapter/adapter.py
```

## Usage

### 1) Binary file -> NDJSON file (for replay)

```bash
python3 hardware_adapter/adapter.py \
  --input file \
  --file data_20260223_120954 \
  --out ndjson > events_from_hw.ndjson
```

Keep `no_data=true` events (debug mode):

```bash
python3 hardware_adapter/adapter.py \
  --input file \
  --file data_20260223_120954 \
  --include-no-data \
  --out ndjson > events_with_no_data.ndjson
```

### 2) Binary file -> TCP server (for live backend)

```bash
python3 hardware_adapter/adapter.py \
  --input file \
  --file data_20260223_120954 \
  --out none \
  --tcp-server 127.0.0.1:9001
```

### 3) stdin pipe -> NDJSON stdout

```bash
cat data_20260223_120954 | python3 hardware_adapter/adapter.py --input stdin --out ndjson > events.ndjson
```

### 4) stdin pipe -> TCP server

```bash
tail -f raw.bin | python3 hardware_adapter/adapter.py --input stdin --out none --tcp-server 127.0.0.1:9999
```

### 5) Push NDJSON to a remote TCP receiver

```bash
python3 hardware_adapter/adapter.py \
  --input file \
  --file data_20260223_120954 \
  --out none \
  --tcp-client 192.168.1.50:9001
```

### 6) SSH passthrough example (NDJSON tunnel)

```bash
tail -f events.ndjson | ssh user@host "cat >> remote.ndjson"
```

## Replay compatibility check

```bash
python3 hardware_adapter/adapter.py --input file --file data_20260223_120954 > events_from_hw.ndjson
QUICKLOOK_MODE=replay QUICKLOOK_REPLAY_PATH=events_from_hw.ndjson uvicorn backend.src.main:app --host 0.0.0.0 --port 8000
curl -s http://127.0.0.1:8000/snapshot | jq '.quality'
```

Expected: backend starts, `/snapshot` remains unchanged schema, and `invalid_channel` should stay `0` unless mapping was intentionally invalid.

## Tiny manual test: validate `no_data` drop behavior

```bash
python3 - <<'PY'
import struct
from pathlib import Path

def word(no_data, t):
    return ((no_data & 1) << 63) | ((123 & 0xFFF) << 51) | ((456 & 0xFFF) << 39) | ((789 & 0xFFF) << 27) | ((t & 0xFFFFFF) << 2)

records = [
    (2, word(0, 100)),
    (2, word(1, 101)),
    (2, word(0, 102)),
]
b = bytearray()
for raw_id, w in records:
    b.extend(struct.pack("<IQ", raw_id, w))
Path("sample_data.bin").write_bytes(b)
PY

# Default: drops one no_data event -> 2 lines
python3 hardware_adapter/adapter.py --input file --file sample_data.bin --out ndjson > dropped.ndjson
wc -l dropped.ndjson

# Debug: includes no_data event -> 3 lines
python3 hardware_adapter/adapter.py --input file --file sample_data.bin --include-no-data --out ndjson > kept.ndjson
wc -l kept.ndjson
```

## Notes

- By default `no_data=1` events are dropped; use `--include-no-data` to emit them with flags for debugging.
- Records beyond 64 discovered channels are dropped with a warning.
