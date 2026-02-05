# Simulator

TCP server emitting NDJSON events for the Quicklook backend.

## Build

```bash
gcc -O2 -std=c11 -Wall -Wextra -o simulator/simulator simulator/src/main.c simulator/src/jsmn.c
```

## Run

```bash
./simulator/simulator --host 0.0.0.0 --port 9001 --channels 8 --rate-hz 400
```

## Arguments

- `--host` (default `0.0.0.0`)
- `--port` (default `9001`)
- `--channels` (default `4`, allowed 1..64)
- `--dead-channel` (optional int, repeatable)
- `--rate-hz` (default `200.0` total events/sec)
- `--seed` (optional int)
- `--config <path>` (optional JSON config file)
- `--burst-mode <on|off>` (default `off`)
- `--drop-rate <0..1>` (default `0`)
- `--stats-interval <seconds>` (default `5`)

## Config File

The config file is JSON and can specify channel and distribution tuning:

```json
{
  "channels": 8,
  "dead_channels": [2],
  "rate_multipliers": [1.0, 0.7, 0.0, 1.4, 1.2, 1.0, 0.9, 0.8],
  "distribution": {
    "g_mean": 2500.0,
    "g_std": 260.0,
    "x_mean": 1700.0,
    "x_std": 200.0,
    "g_event_prob": 0.4
  }
}
```
