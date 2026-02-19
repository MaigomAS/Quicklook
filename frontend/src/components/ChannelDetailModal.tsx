import { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Histogram, LineSeries } from "./Plots";
import { useElementSize } from "./useElementSize";

type Props = {
  open: boolean;
  channel: number | null;
  windowS: number;
  tStartUs: number;
  tEndUs: number;
  rateHz: number;
  adcX: number[];
  adcGtop: number[];
  adcGbot: number[];
  rateTrend: number[];
  hasData: boolean;
  onClose: () => void;
};

function PlotCard({
  title,
  type,
  data,
}: {
  title: string;
  type: "histogram" | "line";
  data: number[];
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(chartRef);

  return (
    <section className="channel-modal-plot">
      <h4>{title}</h4>
      <div ref={chartRef} className="channel-modal-chart-area">
        {type === "histogram" ? (
          <Histogram data={data} width={size.width} height={size.height} variant="modal" />
        ) : (
          <LineSeries data={data} width={size.width} height={size.height} variant="modal" />
        )}
      </div>
    </section>
  );
}

export function ChannelDetailModal({
  open,
  channel,
  windowS,
  tStartUs,
  tEndUs,
  rateHz,
  adcX,
  adcGtop,
  adcGbot,
  rateTrend,
  hasData,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || channel === null) {
    return null;
  }

  return createPortal(
    <div className="channel-modal-overlay" onClick={onClose} role="presentation">
      <div className="channel-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button className="channel-modal-close" onClick={onClose} aria-label="Close channel details">
          ✕
        </button>
        <header className="channel-modal-header">
          <h3>Channel ch {channel}</h3>
          <p>
            window: {windowS}s · {tStartUs} → {tEndUs} us · rate: {rateHz.toFixed(2)} Hz
          </p>
          {!hasData ? <span className="channel-modal-empty">No data for this channel in current window</span> : null}
        </header>
        <div className="channel-modal-grid">
          <PlotCard title="adc_x histogram" type="histogram" data={adcX} />
          <PlotCard title="adc_gtop histogram" type="histogram" data={adcGtop} />
          <PlotCard title="adc_gbot histogram" type="histogram" data={adcGbot} />
          <PlotCard title="rate vs time trend" type="line" data={rateTrend} />
        </div>
      </div>
    </div>,
    document.body
  );
}
