import { useEffect, useMemo, useState } from "react";

type Snapshot = {
  window_s: number;
  t_start_us: number;
  t_end_us: number;
  channels: number[];
  counts_by_channel: Record<string, number>;
  histograms: {
    adc_x: Record<string, number[]>;
    adc_gtop: Record<string, number[]>;
    adc_gbot: Record<string, number[]>;
  };
  ratemap_8x8: number[][];
  rate_history: Record<string, number[]>;
  rate_history_t_end_us: number[];
  notes: string[];
};

type Status = {
  running: boolean;
  connected: boolean;
  last_error?: string | null;
};

type BackendConfig = {
  window_s: number;
  channels: number;
  limits?: {
    min_window_s: number;
    max_window_s: number;
    min_channels: number;
    max_channels: number;
  };
};

type PlotSelection = {
  title: string;
  kind: "histogram" | "line";
  data: number[];
} | null;

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const defaultChannels = Array.from({ length: 64 }, (_, index) => index);
const defaultSnapshot: Snapshot = {
  window_s: 10,
  t_start_us: 0,
  t_end_us: 0,
  channels: defaultChannels,
  counts_by_channel: Object.fromEntries(defaultChannels.map((ch) => [String(ch), 0])),
  histograms: {
    adc_x: Object.fromEntries(defaultChannels.map((ch) => [String(ch), Array(64).fill(0)])),
    adc_gtop: Object.fromEntries(defaultChannels.map((ch) => [String(ch), Array(64).fill(0)])),
    adc_gbot: Object.fromEntries(defaultChannels.map((ch) => [String(ch), Array(64).fill(0)])),
  },
  ratemap_8x8: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0)),
  rate_history: Object.fromEntries(defaultChannels.map((ch) => [String(ch), []])),
  rate_history_t_end_us: [],
  notes: ["waiting for data"],
};

const histogramStreams: Array<{ key: "adc_x" | "adc_gtop" | "adc_gbot"; label: string }> = [
  { key: "adc_x", label: "adc_x" },
  { key: "adc_gtop", label: "adc_gtop" },
  { key: "adc_gbot", label: "adc_gbot" },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const interpolateColor = (start: [number, number, number], end: [number, number, number], t: number) =>
  start.map((channel, index) => Math.round(channel + (end[index] - channel) * t)) as [number, number, number];

const hotColorScale = (value: number, min: number, max: number) => {
  const stops = [
    { at: 0, color: [255, 250, 210] as [number, number, number] },
    { at: 0.4, color: [255, 183, 77] as [number, number, number] },
    { at: 0.75, color: [244, 67, 54] as [number, number, number] },
    { at: 1, color: [139, 0, 0] as [number, number, number] },
  ];
  const normalized = clamp(max === min ? 0 : (value - min) / (max - min), 0, 1);
  const rightIndex = stops.findIndex((stop) => normalized <= stop.at);
  if (rightIndex <= 0) {
    return `rgb(${stops[0].color.join(",")})`;
  }
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const segmentT = (normalized - left.at) / (right.at - left.at);
  return `rgb(${interpolateColor(left.color, right.color, segmentT).join(",")})`;
};

const ensureRatemap = (ratemap?: number[][]) => {
  if (!ratemap || ratemap.length !== 8 || ratemap.some((row) => row.length !== 8)) {
    return defaultSnapshot.ratemap_8x8;
  }
  return ratemap.map((row) => row.map((value) => (Number.isFinite(value) ? value : 0)));
};

const normalizeHistogramRecord = (record?: Record<string, number[]>, channels: number[] = defaultChannels) =>
  Object.fromEntries(
    channels.map((channel) => {
      const values = record?.[String(channel)] ?? [];
      return [
        String(channel),
        Array.isArray(values) ? values.map((value) => (Number.isFinite(value) ? value : 0)) : Array(64).fill(0),
      ];
    })
  );

const normalizeSnapshot = (data?: Partial<Snapshot>) => {
  if (!data) {
    return defaultSnapshot;
  }

  const channels =
    Array.isArray(data.channels) && data.channels.length > 0
      ? data.channels.filter((value) => Number.isFinite(value))
      : defaultChannels;

  return {
    window_s: Number.isFinite(data.window_s) ? data.window_s! : defaultSnapshot.window_s,
    t_start_us: Number.isFinite(data.t_start_us) ? data.t_start_us! : defaultSnapshot.t_start_us,
    t_end_us: Number.isFinite(data.t_end_us) ? data.t_end_us! : defaultSnapshot.t_end_us,
    channels,
    counts_by_channel: Object.fromEntries(
      channels.map((channel) => [String(channel), data.counts_by_channel?.[String(channel)] ?? 0])
    ),
    histograms: {
      adc_x: normalizeHistogramRecord(data.histograms?.adc_x, channels),
      adc_gtop: normalizeHistogramRecord(data.histograms?.adc_gtop, channels),
      adc_gbot: normalizeHistogramRecord(data.histograms?.adc_gbot, channels),
    },
    ratemap_8x8: ensureRatemap(data.ratemap_8x8),
    rate_history: Object.fromEntries(
      channels.map((channel) => [
        String(channel),
        Array.isArray(data.rate_history?.[String(channel)])
          ? data.rate_history?.[String(channel)]?.map((value) => (Number.isFinite(value) ? value : 0)) ?? []
          : [],
      ])
    ),
    rate_history_t_end_us: Array.isArray(data.rate_history_t_end_us)
      ? data.rate_history_t_end_us.filter((value) => Number.isFinite(value))
      : [],
    notes: Array.isArray(data.notes) && data.notes.length > 0 ? data.notes : defaultSnapshot.notes,
  };
};

const normalizeStatus = (data?: Partial<Status>) => ({
  running: Boolean(data?.running),
  connected: Boolean(data?.connected),
  last_error: data?.last_error ?? null,
});

function App() {
  const [status, setStatus] = useState<Status>({ running: false, connected: false });
  const [snapshot, setSnapshot] = useState<Snapshot>(defaultSnapshot);
  const [lastStatusAt, setLastStatusAt] = useState<Date | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<Date | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<PlotSelection>(null);
  const [histOffset, setHistOffset] = useState(0);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settings, setSettings] = useState<BackendConfig>({
    window_s: 10,
    channels: 64,
    limits: {
      min_window_s: 1,
      max_window_s: 3600,
      min_channels: 1,
      max_channels: 64,
    },
  });

  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${backendUrl}/status`)
        .then((res) => res.json())
        .then((data: Status) => {
          setStatus(normalizeStatus(data));
          setLastStatusAt(new Date());
        })
        .catch(() =>
          setStatus((prev) => ({
            ...prev,
            connected: false,
            last_error: prev.last_error ?? "Status fetch failed",
          }))
        );
    };

    const fetchConfig = () => {
      fetch(`${backendUrl}/config`)
        .then((res) => res.json())
        .then((data: BackendConfig) => {
          if (!Number.isFinite(data.window_s) || !Number.isFinite(data.channels)) {
            return;
          }
          setSettings((prev) => ({
            ...prev,
            window_s: data.window_s,
            channels: data.channels,
            limits: data.limits ?? prev.limits,
          }));
        })
        .catch(() => setSettingsError((prev) => prev ?? "Could not fetch settings"));
    };

    const fetchSnapshot = () => {
      fetch(`${backendUrl}/snapshot`)
        .then((res) => res.json())
        .then((data: Snapshot) => {
          setSnapshot(normalizeSnapshot(data));
          setLastSnapshotAt(new Date());
        })
        .catch(() => setSnapshot((prev) => ({ ...prev, notes: ["snapshot fetch failed"] })));
    };

    fetchStatus();
    fetchConfig();
    fetchSnapshot();

    const statusTimer = setInterval(fetchStatus, 2000);
    const snapshotTimer = setInterval(fetchSnapshot, 10000);

    return () => {
      clearInterval(statusTimer);
      clearInterval(snapshotTimer);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedPlot(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const channels = useMemo(() => snapshot.channels, [snapshot.channels]);
  const countsMax = Math.max(1, ...channels.map((ch) => snapshot.counts_by_channel[String(ch)] || 0));
  const heatMax = Math.max(1, ...snapshot.ratemap_8x8.flat());
  const heatMin = Math.min(...snapshot.ratemap_8x8.flat());

  const histogramPageSize = 4;
  const maxHistOffset = Math.max(0, channels.length - histogramPageSize);
  const visibleHistogramChannels = channels.slice(histOffset, histOffset + histogramPageSize);

  useEffect(() => {
    if (histOffset > maxHistOffset) {
      setHistOffset(maxHistOffset);
    }
  }, [histOffset, maxHistOffset]);

  const startAcq = () => fetch(`${backendUrl}/start`, { method: "POST" });
  const stopAcq = () => fetch(`${backendUrl}/stop`, { method: "POST" });

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const response = await fetch(`${backendUrl}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          window_s: Math.round(settings.window_s),
          channels: Math.round(settings.channels),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSettingsError(payload?.detail ?? "Failed to save settings");
        return;
      }
      setSettings((prev) => ({
        ...prev,
        window_s: payload.window_s,
        channels: payload.channels,
      }));
      const freshSnapshot = await fetch(`${backendUrl}/snapshot`).then((res) => res.json());
      setSnapshot(normalizeSnapshot(freshSnapshot));
      setHistOffset(0);
    } catch {
      setSettingsError("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="app-container top-bar-content">
          <div className="controls">
            <button onClick={startAcq} disabled={status.running}>
              Start
            </button>
            <button onClick={stopAcq} disabled={!status.running}>
              Stop
            </button>
          </div>
          <div className="status">
            <span className={status.connected ? "dot ok" : "dot warn"} />
            <span>{status.connected ? "Connected" : "Disconnected"}</span>
            <span className={status.running ? "pill running" : "pill stopped"}>
              {status.running ? "Running" : "Stopped"}
            </span>
            {lastStatusAt ? (
              <span className="timestamp">Status: {lastStatusAt.toLocaleTimeString()}</span>
            ) : null}
            {status.last_error ? <span className="error">{status.last_error}</span> : null}
          </div>
        </div>
      </header>

      <main className="app-container dashboard-grid">
        <section className="panel settings-panel">
          <div className="panel-header">
            <h2>Acquisition Settings</h2>
            <button type="button" onClick={saveSettings} disabled={status.running || savingSettings}>
              {savingSettings ? "Saving..." : "Apply"}
            </button>
          </div>
          <div className="settings-grid">
            <label>
              <span className="label-with-help">
                <span>Aggregation Window (s)</span>
                <span className="help-tooltip-wrap">
                  <span className="help-icon" tabIndex={0} aria-label="Aggregation window help">
                    ⓘ
                  </span>
                  <span className="help-tooltip" role="tooltip">
                    Aggregation window in seconds. This defines the time range used to compute
                    rates in /snapshot (does not control total acquisition duration). Used for
                    computing per-channel rates from snapshot data.
                  </span>
                </span>
              </span>
              <input
                type="number"
                min={settings.limits?.min_window_s ?? 1}
                max={settings.limits?.max_window_s ?? 3600}
                value={settings.window_s}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, window_s: Number(event.target.value) }))
                }
              />
              <span className="input-helper">
                Aggregation window in seconds. This defines the time range used to compute rates in
                /snapshot (does not control total acquisition duration).
              </span>
            </label>
            <label>
              Max channels
              <input
                type="number"
                min={settings.limits?.min_channels ?? 1}
                max={settings.limits?.max_channels ?? 64}
                value={settings.channels}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, channels: Number(event.target.value) }))
                }
              />
            </label>
          </div>
          <p className="subtitle">Stop acquisition before applying configuration changes.</p>
          {settingsError ? <p className="settings-error">{settingsError}</p> : null}
        </section>

        <section className="panel counts-panel">
          <div className="panel-header">
            <div>
              <h2>Counts per Channel</h2>
              <p className="subtitle">
                {channels.length} channels · linear scale · auto max ({countsMax})
              </p>
            </div>
          </div>
          <div className="bar-chart-64">
            {channels.map((ch) => {
              const count = snapshot.counts_by_channel[String(ch)] || 0;
              const height = (count / countsMax) * 100;
              return (
                <div key={ch} className="bar-item-64" title={`ch ${ch}: ${count} counts`}>
                  <div className="bar-64" style={{ height: `${height}%` }} />
                  <span>ch {ch}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel rate-panel">
          <div className="panel-header">
            <div>
              <h2>Rate Map (Hz)</h2>
              <p className="subtitle">8×8 channels · Aggregation Window: {snapshot.window_s}s</p>
            </div>
            {lastSnapshotAt ? (
              <span className="timestamp">Snapshot: {lastSnapshotAt.toLocaleTimeString()}</span>
            ) : null}
          </div>
          <div className="heatmap-wrap">
            <div className="heatmap">
              {snapshot.ratemap_8x8.map((row, rowIndex) =>
                row.map((value, colIndex) => {
                  const color = hotColorScale(value, heatMin, heatMax);
                  return (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className="heat-cell"
                      style={{ backgroundColor: color }}
                      title={`ch ${rowIndex * 8 + colIndex}: ${value.toFixed(2)} Hz`}
                    >
                      {rowIndex * 8 + colIndex}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="color-bar">
            <span>{heatMin.toFixed(2)} Hz</span>
            <div className="gradient" />
            <span>{heatMax.toFixed(2)} Hz</span>
          </div>
        </section>

        <section className="panel histograms-panel">
          <div className="panel-header">
            <div>
              <h2>Histograms + Instant Rate Trend</h2>
              <p className="subtitle">
                4 channels view · Aggregation Window: {snapshot.window_s}s · {snapshot.t_start_us} →{" "}
                {snapshot.t_end_us} μs
              </p>
            </div>
            <div className="channel-nav">
              <button type="button" onClick={() => setHistOffset((prev) => Math.max(0, prev - histogramPageSize))}>
                ↑
              </button>
              <span>
                {histOffset + 1}-{Math.min(histOffset + histogramPageSize, channels.length)} / {channels.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setHistOffset((prev) => Math.min(maxHistOffset, prev + histogramPageSize))
                }
              >
                ↓
              </button>
            </div>
          </div>
          <div className="hist-row header">
            <span>Channel</span>
            <span>adc_x</span>
            <span>adc_gtop</span>
            <span>adc_gbot</span>
            <span>rate vs time</span>
          </div>
          <p className="plot-caption">Y: Counts (per window) • X: ADC units • Trend: Rate (Hz) vs Time (windows)</p>
          <div className="hist-table">
            {visibleHistogramChannels.map((ch, rowIndex) => {
              const isLastRow = rowIndex === visibleHistogramChannels.length - 1;
              return (
                <div key={ch} className="hist-row hist-row-compact">
                  <div className="channel-label">ch {ch}</div>
                  {histogramStreams.map((stream, streamIndex) => {
                    const data = snapshot.histograms[stream.key][String(ch)] || Array(64).fill(0);
                    return (
                      <button
                        key={`${ch}-${stream.key}`}
                        type="button"
                        className="mini-plot"
                        onClick={() =>
                          setSelectedPlot({ title: `Channel ${ch} · ${stream.label}`, kind: "histogram", data })
                        }
                      >
                        <Histogram
                          data={data}
                          height={70}
                          showXAxisLabel={isLastRow}
                          showYAxisLabel={streamIndex === 0}
                        />
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="mini-plot"
                    onClick={() =>
                      setSelectedPlot({
                        title: `Channel ${ch} · Instant rate history`,
                        kind: "line",
                        data: snapshot.rate_history[String(ch)] ?? [],
                      })
                    }
                  >
                    <LineSeries
                      data={snapshot.rate_history[String(ch)] ?? []}
                      height={70}
                      showXAxisLabel={isLastRow}
                      showYAxisLabel={rowIndex === 0}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel notes-panel">
          <h2>Notes</h2>
          <ul className="notes">
            {snapshot.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      </main>

      {selectedPlot ? (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <button className="close" onClick={() => setSelectedPlot(null)}>
              ✕
            </button>
            <h3>{selectedPlot.title}</h3>
            {selectedPlot.kind === "histogram" ? (
              <Histogram data={selectedPlot.data} height={220} />
            ) : (
              <LineSeries data={selectedPlot.data} height={220} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Histogram({
  data,
  height,
  showXAxisLabel = true,
  showYAxisLabel = true,
  showXTicks = true,
  showYTicks = true,
}: {
  data: number[];
  height: number;
  showXAxisLabel?: boolean;
  showYAxisLabel?: boolean;
  showXTicks?: boolean;
  showYTicks?: boolean;
}) {
  const max = Math.max(1, ...data);
  const width = Math.max(data.length, 64);
  const margin = { top: 8, right: 6, bottom: 24, left: 28 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const yTicks = makeLinearTicks(0, max, 4);
  const xTicks = makeLinearTicks(0, Math.max(0, data.length - 1), 5);

  return (
    <svg className="histogram" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {yTicks.map((tick) => {
        const y = margin.top + innerHeight - (tick / max) * innerHeight;
        return <line key={`grid-y-${tick}`} x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="plot-grid" />;
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
      <line x1={margin.left} y1={margin.top + innerHeight} x2={width - margin.right} y2={margin.top + innerHeight} className="plot-axis" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerHeight} className="plot-axis" />
      {showYTicks
        ? yTicks.map((tick) => {
            const y = margin.top + innerHeight - (tick / max) * innerHeight;
            return (
              <g key={`yt-${tick}`}>
                <line x1={margin.left - 3} x2={margin.left} y1={y} y2={y} className="plot-axis" />
                <text x={margin.left - 4} y={y + 2} textAnchor="end" className="plot-tick-label">
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
                <text x={x} y={height - 10} textAnchor="middle" className="plot-tick-label">
                  {Math.round(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXAxisLabel ? (
        <text x={width / 2} y={height - 1.5} textAnchor="middle" className="plot-axis-label">
          ADC units
        </text>
      ) : null}
      {showYAxisLabel ? (
        <text x={margin.left + 1} y={margin.top + 4} textAnchor="start" className="plot-axis-label">
          Counts
        </text>
      ) : null}
    </svg>
  );
}

function LineSeries({
  data,
  height,
  showXAxisLabel = true,
  showYAxisLabel = true,
  showXTicks = true,
  showYTicks = true,
}: {
  data: number[];
  height: number;
  showXAxisLabel?: boolean;
  showYAxisLabel?: boolean;
  showXTicks?: boolean;
  showYTicks?: boolean;
}) {
  if (data.length === 0) {
    return <div className="line-empty">no points yet</div>;
  }

  const max = Math.max(...data, 1);
  const width = 100;
  const margin = { top: 8, right: 6, bottom: 24, left: 28 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
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
    <svg className="line-series" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      {yTicks.map((tick) => {
        const y = margin.top + innerHeight - (tick / max) * innerHeight;
        return <line key={`line-grid-${tick}`} x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="plot-grid" />;
      })}
      <line x1={margin.left} y1={margin.top + innerHeight} x2={width - margin.right} y2={margin.top + innerHeight} className="plot-axis" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerHeight} className="plot-axis" />
      <polyline points={points} fill="none" stroke="#1d4ed8" strokeWidth="2" />
      {showYTicks
        ? yTicks.map((tick) => {
            const y = margin.top + innerHeight - (tick / max) * innerHeight;
            return (
              <g key={`line-yt-${tick}`}>
                <line x1={margin.left - 3} x2={margin.left} y1={y} y2={y} className="plot-axis" />
                <text x={margin.left - 4} y={y + 2} textAnchor="end" className="plot-tick-label">
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
                <text x={x} y={height - 10} textAnchor="middle" className="plot-tick-label">
                  {Math.round(tick)}
                </text>
              </g>
            );
          })
        : null}
      {showXAxisLabel ? (
        <text x={width / 2} y={height - 1.5} textAnchor="middle" className="plot-axis-label">
          Time (windows)
        </text>
      ) : null}
      {showYAxisLabel ? (
        <text x={margin.left + 1} y={margin.top + 4} textAnchor="start" className="plot-axis-label">
          Rate (Hz)
        </text>
      ) : null}
    </svg>
  );
}

export default App;
