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
  notes: string[];
};

type Status = {
  running: boolean;
  connected: boolean;
  last_error?: string | null;
};

type PlotSelection = {
  channel: number;
  stream: "adc_x" | "adc_gtop" | "adc_gbot";
  data: number[];
} | null;

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const defaultSnapshot: Snapshot = {
  window_s: 10,
  t_start_us: 0,
  t_end_us: 0,
  channels: [],
  counts_by_channel: {},
  histograms: { adc_x: {}, adc_gtop: {}, adc_gbot: {} },
  ratemap_8x8: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0)),
  notes: ["waiting for data"],
};

const streams: PlotSelection["stream"][] = ["adc_x", "adc_gtop", "adc_gbot"];

const ensureRatemap = (ratemap?: number[][]) => {
  if (!ratemap || ratemap.length !== 8 || ratemap.some((row) => row.length !== 8)) {
    return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
  }
  return ratemap.map((row) => row.map((value) => (Number.isFinite(value) ? value : 0)));
};

const normalizeHistogramRecord = (record?: Record<string, number[]>) => {
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, values]) => [
      key,
      Array.isArray(values) ? values.map((value) => (Number.isFinite(value) ? value : 0)) : [],
    ])
  );
};

const normalizeSnapshot = (data?: Partial<Snapshot>) => {
  if (!data) {
    return defaultSnapshot;
  }
  return {
    window_s: Number.isFinite(data.window_s) ? data.window_s! : defaultSnapshot.window_s,
    t_start_us: Number.isFinite(data.t_start_us) ? data.t_start_us! : defaultSnapshot.t_start_us,
    t_end_us: Number.isFinite(data.t_end_us) ? data.t_end_us! : defaultSnapshot.t_end_us,
    channels: Array.isArray(data.channels) ? data.channels : defaultSnapshot.channels,
    counts_by_channel: data.counts_by_channel ?? defaultSnapshot.counts_by_channel,
    histograms: {
      adc_x: normalizeHistogramRecord(data.histograms?.adc_x),
      adc_gtop: normalizeHistogramRecord(data.histograms?.adc_gtop),
      adc_gbot: normalizeHistogramRecord(data.histograms?.adc_gbot),
    },
    ratemap_8x8: ensureRatemap(data.ratemap_8x8),
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
  const [channelOffset, setChannelOffset] = useState(0);
  const [selectedPlot, setSelectedPlot] = useState<PlotSelection>(null);

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

  const channels = useMemo(() => {
    if (snapshot.channels.length > 0) {
      return snapshot.channels;
    }
    const inferred = Object.keys(snapshot.counts_by_channel)
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value));
    if (inferred.length > 0) {
      return inferred;
    }
    return [0, 1, 2, 3];
  }, [snapshot.channels, snapshot.counts_by_channel]);

  const maxOffset = Math.max(0, channels.length - 4);
  const visibleChannels = channels.slice(channelOffset, channelOffset + 4);

  const countsMax = Math.max(1, ...Object.values(snapshot.counts_by_channel));
  const heatMax = Math.max(1, ...snapshot.ratemap_8x8.flat());

  const startAcq = () => fetch(`${backendUrl}/start`, { method: "POST" });
  const stopAcq = () => fetch(`${backendUrl}/stop`, { method: "POST" });

  return (
    <div className="app">
      <header className="top-bar">
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
      </header>

      <main className="grid">
        <section className="left-panel">
          <div className="panel">
            <h2>Counts x Channel</h2>
            <div className="bar-chart">
              {channels.map((ch) => {
                const count = snapshot.counts_by_channel[String(ch)] || 0;
                const height = (count / countsMax) * 100;
                return (
                  <div key={ch} className="bar-item">
                    <div className="bar" style={{ height: `${height}%` }} />
                    <span>ch {ch}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h2>Rate Map (8x8)</h2>
              {lastSnapshotAt ? (
                <span className="timestamp">Snapshot: {lastSnapshotAt.toLocaleTimeString()}</span>
              ) : null}
            </div>
            <div className="heatmap">
              {snapshot.ratemap_8x8.map((row, rowIndex) =>
                row.map((value, colIndex) => {
                  const intensity = value / heatMax;
                  const color = `rgba(34, 102, 204, ${0.2 + intensity * 0.8})`;
                  return (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className="heat-cell"
                      style={{ backgroundColor: color }}
                      title={`ch ${rowIndex * 8 + colIndex}: ${value.toFixed(2)} Hz`}
                    />
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="right-panel">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Histograms</h2>
                <p className="subtitle">
                  Window: {snapshot.window_s}s · {snapshot.t_start_us} → {snapshot.t_end_us} μs
                </p>
              </div>
              <div className="slider">
                <label htmlFor="channelOffset">Channel window</label>
                <input
                  id="channelOffset"
                  type="range"
                  min={0}
                  max={maxOffset}
                  value={channelOffset}
                  onChange={(event) => setChannelOffset(Number(event.target.value))}
                />
              </div>
            </div>
            <div className="mini-grid">
              {visibleChannels.map((ch) =>
                streams.map((stream) => {
                  const data = snapshot.histograms[stream][String(ch)] || Array(64).fill(0);
                  return (
                    <div
                      key={`${ch}-${stream}`}
                      className="mini-plot"
                      onClick={() => setSelectedPlot({ channel: ch, stream, data })}
                    >
                      <div className="mini-title">
                        ch {ch} · {stream}
                      </div>
                      <Histogram data={data} height={48} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="panel">
            <h2>Notes</h2>
            <ul className="notes">
              {snapshot.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      {selectedPlot ? (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-content">
            <button className="close" onClick={() => setSelectedPlot(null)}>
              ✕
            </button>
            <h3>
              Channel {selectedPlot.channel} · {selectedPlot.stream}
            </h3>
            <Histogram data={selectedPlot.data} height={200} />
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
          <rect
            key={index}
            x={index}
            y={height - barHeight}
            width={0.9}
            height={barHeight}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

export default App;
