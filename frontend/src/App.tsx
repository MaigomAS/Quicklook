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
          if (!Number.isFinite(data.window_s)) {
            return;
          }
          setSettings((prev) => ({
            ...prev,
            window_s: data.window_s,
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

  const channels = useMemo(() => defaultChannels, []);
  const countsMax = Math.max(1, ...channels.map((ch) => snapshot.counts_by_channel[String(ch)] || 0));
  const heatMax = Math.max(1, ...snapshot.ratemap_8x8.flat());

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
          channels: 64,
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
          <div className="top-bar-main">
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
              {lastSnapshotAt ? (
                <span className="timestamp">Snapshot: {lastSnapshotAt.toLocaleTimeString()}</span>
              ) : null}
              {status.last_error ? <span className="error">{status.last_error}</span> : null}
            </div>
          </div>
          <div className="inline-settings">
            <span className="inline-settings-title">Acquisition Settings</span>
            <label>
              Aggregation Window (s)
              <input
                type="number"
                min={settings.limits?.min_window_s ?? 1}
                max={settings.limits?.max_window_s ?? 3600}
                value={settings.window_s}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, window_s: Number(event.target.value) }))
                }
              />
            </label>
            <button type="button" onClick={saveSettings} disabled={status.running || savingSettings}>
              {savingSettings ? "Saving..." : "Apply"}
            </button>
          </div>
        </div>
      </header>

      <main className="app-container dashboard-grid">
        <section className="panel counts-panel">
          <div className="panel-header">
            <div>
              <h2>Rate (Hz) per Channel</h2>
              <p className="subtitle">64 channels · linear scale · auto max ({countsMax})</p>
            </div>
          </div>
          <div className="bar-chart-wrap">
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
          </div>
        </section>

        <section className="panel rate-panel">
          <div className="panel-header">
            <h2>Rate Map (8x8)</h2>
          </div>
          <div className="heatmap">
            {snapshot.ratemap_8x8.map((row, rowIndex) =>
              row.map((value, colIndex) => {
                const intensity = value / heatMax;
                const color = `rgba(34, 102, 204, ${0.15 + intensity * 0.85})`;
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
          <div className="color-bar">
            <span>0 Hz</span>
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
          <div className="hist-table">
            {visibleHistogramChannels.map((ch) => (
              <div key={ch} className="hist-row hist-row-compact">
                <div className="channel-label">ch {ch}</div>
                {histogramStreams.map((stream) => {
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
                      <Histogram data={data} height={70} />
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
                  <LineSeries data={snapshot.rate_history[String(ch)] ?? []} height={70} />
                </button>
              </div>
            ))}
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
      {settingsError ? <p className="settings-error app-container">{settingsError}</p> : null}

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

function Histogram({ data, height }: { data: number[]; height: number }) {
  const max = Math.max(1, ...data);
  return (
    <svg className="histogram" viewBox={`0 0 64 ${height}`} preserveAspectRatio="none">
      {data.map((value, index) => {
        const barHeight = (value / max) * height;
        return (
          <rect key={index} x={index} y={height - barHeight} width={0.9} height={barHeight} rx={0.5} />
        );
      })}
    </svg>
  );
}

function LineSeries({ data, height }: { data: number[]; height: number }) {
  if (data.length === 0) {
    return <div className="line-empty">no points yet</div>;
  }

  const max = Math.max(...data, 1);
  const points = data
    .map((value, index) => {
      const x = data.length === 1 ? 0 : (index / (data.length - 1)) * 100;
      const y = height - (value / max) * height;
      return `${x},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="line-series" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="#1d4ed8" strokeWidth="2" />
    </svg>
  );
}

export default App;
