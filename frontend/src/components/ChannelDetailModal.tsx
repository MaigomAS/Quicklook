import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Histogram, LineSeries } from "./Plots";
import { useElementSize } from "./useElementSize";

type Props = {
  open: boolean;
  channel: number | null;
  windowS: number;
  tStartUs: number;
  tEndUs: number;
  countsInWindow: number;
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
  const [stableSize, setStableSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let frameOne = 0;
    let frameTwo = 0;

    if (size.width < 80 || size.height < 80) {
      setStableSize({ width: 0, height: 0 });
      return;
    }

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        setStableSize(size);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, [size]);

  const showChart = stableSize.width >= 80 && stableSize.height >= 80;

  return (
    <section className="channel-modal-plot">
      <h4>{title}</h4>
      <div ref={chartRef} className="channel-modal-chart-area">
        {!showChart ? (
          <div className="channel-modal-chart-skeleton" aria-hidden="true" />
        ) : type === "histogram" ? (
          <Histogram data={data} width={stableSize.width} height={stableSize.height} variant="modal" />
        ) : (
          <LineSeries data={data} width={stableSize.width} height={stableSize.height} variant="modal" />
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
  countsInWindow,
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
            window: {windowS}s · {tStartUs} → {tEndUs} us · counts in window: {countsInWindow.toFixed(0)}
          </p>
          {!hasData ? <span className="channel-modal-empty">No data for this channel in current window</span> : null}
        </header>
        <div className="channel-modal-grid">
          <PlotCard title="ADC_X Spectrum (accumulated in window)" type="histogram" data={adcX} />
          <PlotCard title="ADC_GTOP Spectrum (accumulated in window)" type="histogram" data={adcGtop} />
          <PlotCard title="ADC_GBOT Spectrum (accumulated in window)" type="histogram" data={adcGbot} />
          <PlotCard title="Rate Trend (Hz)" type="line" data={rateTrend} />
        </div>
      </div>
    </div>,
    document.body
  );
}
