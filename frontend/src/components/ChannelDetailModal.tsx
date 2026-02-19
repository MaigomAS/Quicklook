import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Histogram, LineSeries } from "./PlotCharts";

type ChannelDetailSnapshot = {
  window_s: number;
  t_start_us: number;
  t_end_us: number;
  channels: number[];
  histograms: {
    adc_x: Record<string, number[]>;
    adc_gtop: Record<string, number[]>;
    adc_gbot: Record<string, number[]>;
  };
  rate_history: Record<string, number[]>;
  ratemap_8x8: number[][];
};

type ChannelDetailModalProps = {
  open: boolean;
  channel: number | null;
  snapshot: ChannelDetailSnapshot;
  onClose: () => void;
};

export function ChannelDetailModal({ open, channel, snapshot, onClose }: ChannelDetailModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, open]);

  if (!open || channel === null) {
    return null;
  }

  const hasChannelData = snapshot.channels.includes(channel);
  const key = String(channel);
  const histAdcX = snapshot.histograms.adc_x[key] ?? Array(64).fill(0);
  const histAdcGtop = snapshot.histograms.adc_gtop[key] ?? Array(64).fill(0);
  const histAdcGbot = snapshot.histograms.adc_gbot[key] ?? Array(64).fill(0);
  const trend = snapshot.rate_history[key] ?? [];
  const row = Math.floor(channel / 8);
  const col = channel % 8;
  const currentRate = snapshot.ratemap_8x8[row]?.[col] ?? 0;

  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section className="channel-modal" role="dialog" aria-modal="true" aria-label={`Channel ${channel} details`} onClick={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close channel detail modal">
          ✕
        </button>
        <header className="channel-modal-header">
          <h3>Channel ch {channel}</h3>
          <p>
            window {snapshot.window_s}s · {snapshot.t_start_us} μs → {snapshot.t_end_us} μs · rate {currentRate.toFixed(2)} Hz
          </p>
        </header>
        {!hasChannelData ? <p className="channel-modal-note">No data for this channel in current window</p> : null}
        <div className="channel-modal-grid">
          <article className="channel-plot-card">
            <h4>adc_x histogram</h4>
            <Histogram data={histAdcX} height={250} />
          </article>
          <article className="channel-plot-card">
            <h4>adc_gtop histogram</h4>
            <Histogram data={histAdcGtop} height={250} />
          </article>
          <article className="channel-plot-card">
            <h4>adc_gbot histogram</h4>
            <Histogram data={histAdcGbot} height={250} />
          </article>
          <article className="channel-plot-card">
            <h4>rate vs time trend</h4>
            <LineSeries data={trend} height={250} />
          </article>
        </div>
      </section>
    </div>,
    document.body
  );
}
