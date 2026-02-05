# UX Spec

## Layout

- **Top bar**: Start/Stop controls, acquisition status, connection indicator.
- **Left column**:
  - Counts by channel bar chart.
  - 8x8 heatmap showing rate per channel.
- **Right column**:
  - Mini-plot grid (histograms) for `adc_x`, `adc_gtop`, `adc_gbot`.
  - Show 4 channels at a time with a slider to shift the channel window.
  - Clicking a mini-plot opens a modal with a larger plot.

## Interaction

- Start triggers `/start` and begins acquisition.
- Stop triggers `/stop` and freezes the latest snapshot.
- Status polled every 2s; snapshot polled every 10s.

## Visual Style

- Minimal clean styling, simple charts built with CSS/SVG.
- Dark modal overlay for plot details, close via X or ESC.
