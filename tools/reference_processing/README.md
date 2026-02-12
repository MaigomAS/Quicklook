# Golden Reference Processing Tools

These scripts provide **scientifically aligned reference processing** for validating
Quicklook snapshot output.

## Methodology

### Counts by channel
1. Parse JSONL events (`one JSON object per line`).
2. Keep only valid events:
   - `t_us > 0`
   - `0 <= channel < 64`
3. Increment channel counter for each accepted event.

This matches Quicklook `snapshot.counts_by_channel` semantics.

### Rate heatmap (8x8)
1. Start from counts by channel.
2. Convert counts to rates using:
   - `rate[channel] = counts[channel] / window_s`
3. Map channel to 8x8 using:
   - `row = channel // 8`
   - `col = channel % 8`

This matches Quicklook `snapshot.ratemap_8x8` semantics.

## Expected fields in event records
- Required: `t_us`, `channel`
- Optional: `adc_x`, `adc_gtop`, `adc_gbot` (used for spectra/hist views)

## Scripts
- `ql_ref_counts_by_channel.py`
  - Produces counts-by-channel bar plot.
- `ql_ref_rate_heatmap_8x8.py`
  - Produces 8x8 rate heatmap plot.
- `ql_ref_grid_spectra.py`
  - Produces 8x8 grid of per-channel ADC spectra.
- `compare_snapshot_to_reference.py`
  - Fetches `/config` + `/snapshot`, prints operational summary, and can compare
    against local reference processing.

## Example commands
```bash
python tools/reference_processing/ql_ref_counts_by_channel.py data/events.jsonl --out out/counts.png
python tools/reference_processing/ql_ref_rate_heatmap_8x8.py data/events.jsonl --out out/heatmap.png
python tools/reference_processing/ql_ref_grid_spectra.py data/events.jsonl --out out/spectra.png
python tools/reference_processing/compare_snapshot_to_reference.py --base-url http://127.0.0.1:8000 --input data/events.jsonl
```
