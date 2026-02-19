import { useRef } from "react";
import { useElementSize } from "./useElementSize";

type SharedPlotProps = {
  data: number[];
  height?: number;
  width?: number;
  showXAxisLabel?: boolean;
  showYAxisLabel?: boolean;
  showXTicks?: boolean;
  showYTicks?: boolean;
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

export function MiniPlotChart({
  kind,
  data,
  showXAxisLabel,
  showYAxisLabel,
}: {
  kind: "histogram" | "line";
  data: number[];
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
          showXAxisLabel={showXAxisLabel}
          showYAxisLabel={showYAxisLabel}
        />
      ) : (
        <LineSeries
          data={data}
          width={size.width}
          height={size.height}
          showXAxisLabel={showXAxisLabel}
          showYAxisLabel={showYAxisLabel}
        />
      )}
    </div>
  );
}

export function Histogram({
  data,
  height = 220,
  width,
  showXAxisLabel = true,
  showYAxisLabel = true,
  showXTicks = true,
  showYTicks = true,
}: SharedPlotProps) {
  const max = Math.max(1, ...data);
  const chartWidth = Math.max(60, width ?? Math.max(data.length, 64));
  const chartHeight = Math.max(48, height);
  const left = showYTicks ? Math.max(18, Math.min(28, chartWidth * 0.2)) : 8;
  const bottom = showXTicks || showXAxisLabel ? Math.max(12, Math.min(20, chartHeight * 0.22)) : 7;
  const margin = { top: 6, right: 4, bottom, left };
  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right);
  const innerHeight = Math.max(1, chartHeight - margin.top - margin.bottom);
  const tickFont = Math.max(5.5, Math.min(7.5, chartHeight * 0.09));
  const axisLabelFont = tickFont + 0.6;
  const yTicks = makeLinearTicks(0, max, 4);
  const xTicks = makeLinearTicks(0, Math.max(0, data.length - 1), 5);

  return (
    <svg className="histogram" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
      {yTicks.map((tick) => {
        const y = margin.top + innerHeight - (tick / max) * innerHeight;
        return (
          <line
            key={`grid-y-${tick}`}
            x1={margin.left}
            x2={chartWidth - margin.right}
            y1={y}
            y2={y}
            className="plot-grid"
          />
        );
      })}
      {data.map((value, index) => {
        const barWidth = innerWidth / Math.max(1, data.length);
        const barHeight = (value / max) * innerHeight;
        const x = margin.left + index * barWidth + barWidth * 0.08;
        return (
          <rect
            key={index}
            x={x}
            y={margin.top + innerHeight - barHeight}
            width={Math.max(0.6, barWidth * 0.84)}
            height={barHeight}
            rx={0.5}
          />
        );
      })}
      <line
        x1={margin.left}
        y1={margin.top + innerHeight}
        x2={chartWidth - margin.right}
        y2={margin.top + innerHeight}
        className="plot-axis"
      />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerHeight} className="plot-axis" />
      {showYTicks
        ? yTicks.map((tick) => {
            const y = margin.top + innerHeight - (tick / max) * innerHeight;
            return (
              <g key={`yt-${tick}`}>
                <line x1={margin.left - 3} x2={margin.left} y1={y} y2={y} className="plot-axis" />
                <text x={margin.left - 4} y={y + 2} textAnchor="end" className="plot-tick-label" style={{ fontSize: `${tickFont}px` }}>
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
              <g key={`xt-${tick}`}>
                <line x1={x} x2={x} y1={margin.top + innerHeight} y2={margin.top + innerHeight + 2.5} className="plot-axis" />
                <text x={x} y={chartHeight - 8} textAnchor="middle" className="plot-tick-label" style={{ fontSize: `${tickFont}px` }}>
                  {Math.round(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXAxisLabel ? (
        <text x={chartWidth / 2} y={chartHeight - 1.5} textAnchor="middle" className="plot-axis-label" style={{ fontSize: `${axisLabelFont}px` }}>
          ADC units
        </text>
      ) : null}
      {showYAxisLabel ? (
        <text x={margin.left + 1} y={margin.top + 4} textAnchor="start" className="plot-axis-label" style={{ fontSize: `${axisLabelFont}px` }}>
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
  showXAxisLabel = true,
  showYAxisLabel = true,
  showXTicks = true,
  showYTicks = true,
}: SharedPlotProps) {
  if (data.length === 0) {
    return <div className="line-empty">no points yet</div>;
  }

  const max = Math.max(...data, 1);
  const chartWidth = Math.max(60, width ?? 100);
  const chartHeight = Math.max(48, height);
  const left = showYTicks ? Math.max(18, Math.min(28, chartWidth * 0.2)) : 8;
  const bottom = showXTicks || showXAxisLabel ? Math.max(12, Math.min(20, chartHeight * 0.22)) : 7;
  const margin = { top: 6, right: 4, bottom, left };
  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right);
  const innerHeight = Math.max(1, chartHeight - margin.top - margin.bottom);
  const tickFont = Math.max(5.5, Math.min(7.5, chartHeight * 0.09));
  const axisLabelFont = tickFont + 0.6;
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
      <polyline points={points} fill="none" stroke="var(--ql-accent-strong)" strokeWidth="2" />
      {showYTicks
        ? yTicks.map((tick) => {
            const y = margin.top + innerHeight - (tick / max) * innerHeight;
            return (
              <g key={`line-yt-${tick}`}>
                <line x1={margin.left - 3} x2={margin.left} y1={y} y2={y} className="plot-axis" />
                <text x={margin.left - 4} y={y + 2} textAnchor="end" className="plot-tick-label" style={{ fontSize: `${tickFont}px` }}>
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
                <line x1={x} x2={x} y1={margin.top + innerHeight} y2={margin.top + innerHeight + 2.5} className="plot-axis" />
                <text x={x} y={chartHeight - 8} textAnchor="middle" className="plot-tick-label" style={{ fontSize: `${tickFont}px` }}>
                  {Math.round(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXAxisLabel ? (
        <text x={chartWidth / 2} y={chartHeight - 1.5} textAnchor="middle" className="plot-axis-label" style={{ fontSize: `${axisLabelFont}px` }}>
          Time (windows)
        </text>
      ) : null}
      {showYAxisLabel ? (
        <text x={margin.left + 1} y={margin.top + 4} textAnchor="start" className="plot-axis-label" style={{ fontSize: `${axisLabelFont}px` }}>
          Rate (Hz)
        </text>
      ) : null}
    </svg>
  );
}
