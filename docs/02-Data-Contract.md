# Data Contract

## A) Event Message (Simulator -> Backend)

The simulator sends **one JSON object per line** (NDJSON) over TCP:

```json
{
  "t_us": 1234567890,
  "channel": 12,
  "adc_x": 2048,
  "adc_gtop": 2311,
  "adc_gbot": 1998,
  "flags": {
    "trg_x": true,
    "trg_g": false,
    "no_data": false,
    "is_g_event": false
  }
}
```

Constraints:
- `t_us`: int64 microseconds, monotonic increasing.
- `channel`: integer 0..63.
- `adc_*`: integer 0..4095.
- `flags`: boolean fields as shown.

## B) Aggregated Snapshot (Backend -> Frontend)

```json
{
  "window_s": 10,
  "t_start_us": 1234567890,
  "t_end_us": 1234577890,
  "channels": [0, 1, 2, 3],
  "counts_by_channel": {"0": 500, "1": 450},
  "histograms": {
    "adc_x": {"0": [64 bins], "1": [64 bins]},
    "adc_gtop": {"0": [64 bins], "1": [64 bins]},
    "adc_gbot": {"0": [64 bins], "1": [64 bins]}
  },
  "ratemap_8x8": [[8 floats] x 8 rows],
  "notes": ["strings"]
}
```

Notes:
- Histogram bins map ADC 0..4095 into 64 bins.
- `ratemap_8x8` uses channel index mapping: `row = channel // 8`, `col = channel % 8`, value = `counts / window_s`.
