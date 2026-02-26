import { useRef } from "react";
import { useElementSize } from "./useElementSize";

type PlotVariant = "mini" | "modal";

type SharedPlotProps = {
  data: number[];
  height?: number;
  width?: number;
  yMax?: number;
  showXAxisLabel?: boolean;
  showYAxisLabel?: boolean;
  showXTicks?: boolean;
  showYTicks?: boolean;
  variant?: PlotVariant;
};

const makeLinearTicks = (min: number, max: number, count = 5) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0];
  }
  if (min === max) {
    return [min];
  }
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
};

const formatAxisTick = (value: number) => {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
};

const getPlotMetrics = (chartWidth: number, chartHeight: number, variant: PlotVariant, showYTicks: boolean, showXTicksOrLabel: boolean) => {
  if (variant === "modal") {
    const left = showYTicks ? 48 : 12;
    const bottom = showXTicksOrLabel ? 34 : 10;
    const tickFont = 11;
    const axisLabelFont = 12;
    return { left, bottom, tickFont, axisLabelFont, top: 12, right: 12 };
  }

  const left = showYTicks ? Math.max(18, Math.min(28, chartWidth * 0.2)) : 8;
  const bottom = showXTicksOrLabel ? Math.max(12, Math.min(20, chartHeight * 0.22)) : 7;
  const tickFont = Math.max(5.5, Math.min(7.5, chartHeight * 0.09));
  const axisLabelFont = tickFont + 0.6;
  return { left, bottom, tickFont, axisLabelFont, top: 6, right: 4 };
};

export function MiniPlotChart({
  kind,
  data,
  yMax,
  showXAxisLabel,
  showYAxisLabel,
}: {
  kind: "histogram" | "line";
  data: number[];
  yMax?: number;
  showXAxisLabel: boolean;
  showYAxisLabel: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapperRef);

  return (
    <div ref={wrapperRef} className="mini-plot-canvas">
      {kind === "histogram" ? (
        <Histogram
          data={data}
          width={size.width}
          height={size.height}
          yMax={yMax}
          showXAxisLabel={showXAxisLabel}
          showYAxisLabel={showYAxisLabel}
          variant="mini"
        />
      ) : (
        <LineSeries
          data={data}
          width={size.width}
          height={size.height}
          yMax={yMax}
          showXAxisLabel={showXAxisLabel}
          showYAxisLabel={showYAxisLabel}
          variant="mini"
        />
      )}
    </div>
  );
}

export function Histogram({
  data,
  height = 220,
  width,
  yMax,
  showXAxisLabel = true,
  showYAxisLabel = true,
  showXTicks = true,
  showYTicks = true,
  variant = "mini",
}: SharedPlotProps) {
  const safeData = data.length > 0 ? data : Array(64).fill(0);
  const max = Number.isFinite(yMax) && yMax! > 0 ? yMax! : Math.max(1, ...safeData);
  const chartWidth = Math.max(60, width ?? Math.max(safeData.length, 64));
  const chartHeight = Math.max(48, height);
  const metrics = getPlotMetrics(chartWidth, chartHeight, variant, showYTicks, showXTicks || showXAxisLabel);
  const margin = { top: metrics.top, right: metrics.right, bottom: metrics.bottom, left: metrics.left };
  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right);
  const innerHeight = Math.max(1, chartHeight - margin.top - margin.bottom);
  const yTicks = makeLinearTicks(0, max, 4);
  const xTicks = makeLinearTicks(0, Math.max(0, safeData.length - 1), 5);

  return (
    <svg className="histogram" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
      {yTicks.map((tick) => {
        const y = margin.top + innerHeight - (tick / max) * innerHeight;
        return <line key={`grid-y-${tick}`} x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} className="plot-grid" />;
      })}
      {safeData.map((value, index) => {
        const barWidth = innerWidth / Math.max(1, safeData.length);
        const barHeight = (value / max) * innerHeight;
        const x = margin.left + index * barWidth + barWidth * 0.08;
        return (
          <rect
            key={index}
            x={x}
            y={margin.top + innerHeight - barHeight}
            width={Math.max(0.6, barWidth * 0.84)}
            height={barHeight}
            rx={variant === "modal" ? 1.2 : 0.5}
            className="plot-bar"
          />
        );
      })}
      <line x1={margin.left} y1={margin.top + innerHeight} x2={chartWidth - margin.right} y2={margin.top + innerHeight} className="plot-axis" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerHeight} className="plot-axis" />
      {showYTicks
        ? yTicks.map((tick) => {
            const y = margin.top + innerHeight - (tick / max) * innerHeight;
            return (
              <g key={`yt-${tick}`}>
                <line x1={margin.left - 4} x2={margin.left} y1={y} y2={y} className="plot-axis" />
                <text x={margin.left - 6} y={y + 4} textAnchor="end" className="plot-tick-label" style={{ fontSize: `${metrics.tickFont}px` }}>
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXTicks
        ? xTicks.map((tick) => {
            const ratio = safeData.length <= 1 ? 0 : tick / (safeData.length - 1);
            const x = margin.left + ratio * innerWidth;
            return (
              <g key={`xt-${tick}`}>
                <line x1={x} x2={x} y1={margin.top + innerHeight} y2={margin.top + innerHeight + 4} className="plot-axis" />
                <text x={x} y={chartHeight - (showXAxisLabel ? 16 : 8)} textAnchor="middle" className="plot-tick-label" style={{ fontSize: `${metrics.tickFont}px` }}>
                  {Math.round(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXAxisLabel ? (
        <text x={chartWidth / 2} y={chartHeight - 4} textAnchor="middle" className="plot-axis-label" style={{ fontSize: `${metrics.axisLabelFont}px` }}>
          ADC units
        </text>
      ) : null}
      {showYAxisLabel ? (
        <text
          x={Math.max(10, margin.left - 16)}
          y={margin.top + innerHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${Math.max(10, margin.left - 16)} ${margin.top + innerHeight / 2})`}
          className="plot-axis-label"
          style={{ fontSize: `${metrics.axisLabelFont}px` }}
        >
          Counts
        </text>
      ) : null}
    </svg>
  );
}

export function LineSeries({
  data,
  height = 220,
  width,
  yMax,
  showXAxisLabel = true,
  showYAxisLabel = true,
  showXTicks = true,
  showYTicks = true,
  variant = "mini",
}: SharedPlotProps) {
  if (data.length === 0) {
    return <div className="line-empty">no points yet</div>;
  }

  const max = Number.isFinite(yMax) && yMax! > 0 ? yMax! : Math.max(...data, 1);
  const chartWidth = Math.max(60, width ?? 100);
  const chartHeight = Math.max(48, height);
  const metrics = getPlotMetrics(chartWidth, chartHeight, variant, showYTicks, showXTicks || showXAxisLabel);
  const margin = { top: metrics.top, right: metrics.right, bottom: metrics.bottom, left: metrics.left };
  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right);
  const innerHeight = Math.max(1, chartHeight - margin.top - margin.bottom);
  const yTicks = makeLinearTicks(0, max, 4);
  const xTicks = makeLinearTicks(0, Math.max(0, data.length - 1), 5);
  const points = data
    .map((value, index) => {
      const x = margin.left + (data.length === 1 ? 0 : (index / (data.length - 1)) * innerWidth);
      const y = margin.top + innerHeight - (value / max) * innerHeight;
      return `${x},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="line-series" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
      {yTicks.map((tick) => {
        const y = margin.top + innerHeight - (tick / max) * innerHeight;
        return <line key={`line-grid-${tick}`} x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} className="plot-grid" />;
      })}
      <line x1={margin.left} y1={margin.top + innerHeight} x2={chartWidth - margin.right} y2={margin.top + innerHeight} className="plot-axis" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerHeight} className="plot-axis" />
      <polyline points={points} fill="none" stroke="var(--ql-accent-strong)" strokeWidth={variant === "modal" ? 2.4 : 2} className="plot-line" />
      {showYTicks
        ? yTicks.map((tick) => {
            const y = margin.top + innerHeight - (tick / max) * innerHeight;
            return (
              <g key={`line-yt-${tick}`}>
                <line x1={margin.left - 4} x2={margin.left} y1={y} y2={y} className="plot-axis" />
                <text x={margin.left - 6} y={y + 4} textAnchor="end" className="plot-tick-label" style={{ fontSize: `${metrics.tickFont}px` }}>
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXTicks
        ? xTicks.map((tick) => {
            const ratio = data.length <= 1 ? 0 : tick / (data.length - 1);
            const x = margin.left + ratio * innerWidth;
            return (
              <g key={`line-xt-${tick}`}>
                <line x1={x} x2={x} y1={margin.top + innerHeight} y2={margin.top + innerHeight + 4} className="plot-axis" />
                <text x={x} y={chartHeight - (showXAxisLabel ? 16 : 8)} textAnchor="middle" className="plot-tick-label" style={{ fontSize: `${metrics.tickFont}px` }}>
                  {Math.round(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXAxisLabel ? (
        <text x={chartWidth / 2} y={chartHeight - 4} textAnchor="middle" className="plot-axis-label" style={{ fontSize: `${metrics.axisLabelFont}px` }}>
          Time
        </text>
      ) : null}
      {showYAxisLabel ? (
        <text
          x={Math.max(10, margin.left - 16)}
          y={margin.top + innerHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${Math.max(10, margin.left - 16)} ${margin.top + innerHeight / 2})`}
          className="plot-axis-label"
          style={{ fontSize: `${metrics.axisLabelFont}px` }}
        >
          Rate [Hz]
        </text>
      ) : null}
    </svg>
  );
}
