import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Histogram, LineSeries } from "./Plots";

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
        <div className="channel-modal-header">
          <h3>Channel ch {channel}</h3>
          <p>
            window: {windowS}s · {tStartUs} → {tEndUs} us · rate: {rateHz.toFixed(2)} Hz
          </p>
          {!hasData ? <span className="channel-modal-empty">No data for this channel in current window</span> : null}
        </div>
        <div className="channel-modal-grid">
          <div className="channel-modal-plot">
            <h4>adc_x histogram</h4>
            <Histogram data={adcX} height={280} />
          </div>
          <div className="channel-modal-plot">
            <h4>adc_gtop histogram</h4>
            <Histogram data={adcGtop} height={280} />
          </div>
          <div className="channel-modal-plot">
            <h4>adc_gbot histogram</h4>
            <Histogram data={adcGbot} height={280} />
          </div>
          <div className="channel-modal-plot">
            <h4>rate vs time trend</h4>
            <LineSeries data={rateTrend} height={280} />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
