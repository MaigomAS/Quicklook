# Test Data Simulator

## Overview

The simulator emits NDJSON events over TCP. It models realistic conditions:

- Per-channel rate multipliers (stable per seed)
- Gaussian ADC peaks + noise floor
- Separate distributions for `is_g_event`
- Occasional `no_data` events

## CLI

```
./simulator/simulator [--host 0.0.0.0] [--port 9001]
  --channels <1..64> [--dead-channel <int>]
  --rate-hz <float total> [--seed <int>]
```

## Example

```bash
./simulator/simulator --channels 16 --rate-hz 800 --dead-channel 3 --seed 42
```

Logs indicate the effective channel rates and any dead channel.
