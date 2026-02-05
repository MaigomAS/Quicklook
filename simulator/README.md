# Simulator

TCP server emitting NDJSON events for the Quicklook backend.

## Build

```bash
gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c
```

## Run

```bash
./simulator/simulator --host 0.0.0.0 --port 9001 --channels 8 --rate-hz 400
```

## Arguments

- `--host` (default `0.0.0.0`)
- `--port` (default `9001`)
- `--channels` (default `4`, allowed 1..64)
- `--dead-channel` (optional int)
- `--rate-hz` (default `200.0` total events/sec)
- `--seed` (optional int)
