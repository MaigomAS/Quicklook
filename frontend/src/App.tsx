import { useEffect, useMemo, useRef, useState } from "react";
import { ChannelDetailModal } from "./components/ChannelDetailModal";
import { MiniPlotChart } from "./components/Plots";
import { useElementSize } from "./components/useElementSize";

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

const HISTOGRAM_BIN_COUNT = 64;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const niceCeil = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceStep * base;
};

const formatRateMax = (value: number) => {
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
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
      const normalizedValues = Array.isArray(values)
        ? values.slice(0, HISTOGRAM_BIN_COUNT).map((value) => (Number.isFinite(value) ? value : 0))
        : [];
      return [
        String(channel),
        normalizedValues.length < HISTOGRAM_BIN_COUNT
          ? [...normalizedValues, ...Array(HISTOGRAM_BIN_COUNT - normalizedValues.length).fill(0)]
          : normalizedValues,
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

type ViewMode = "dashboard" | "monitor";
type MultiChannelPlotMode = "adc_x" | "adc_gtop" | "adc_gbot" | "rate_vs_time";

const getModeYAxisMax = (snapshot: Snapshot, mode: MultiChannelPlotMode, channels: number[]) => {
  const values =
    mode === "rate_vs_time"
      ? channels.flatMap((channel) => snapshot.rate_history[String(channel)] ?? [])
      : channels.flatMap((channel) => snapshot.histograms[mode][String(channel)] ?? []);
  const max = Math.max(1, ...values);
  return niceCeil(max * 1.1);
};

function App({ viewMode = "dashboard" }: { viewMode?: ViewMode }) {
  const [status, setStatus] = useState<Status>({ running: false, connected: false });
  const [snapshot, setSnapshot] = useState<Snapshot>(defaultSnapshot);
  const [lastStatusAt, setLastStatusAt] = useState<Date | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<Date | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [recentChannels, setRecentChannels] = useState<number[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
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
            channels: 64,
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

  const channels = useMemo(() => defaultChannels, []);
  const rawCountsMax = Math.max(1, ...channels.map((ch) => snapshot.counts_by_channel[String(ch)] || 0));
  const countsMax = niceCeil(rawCountsMax * 1.06);
  const heatMax = Math.max(1, ...snapshot.ratemap_8x8.flat());
  const heatMin = Math.min(...snapshot.ratemap_8x8.flat());

  const histogramPageSize = 4;
  const orderedChannels = useMemo(() => {
    const recentSet = new Set(recentChannels);
    return [...recentChannels, ...channels.filter((channel) => !recentSet.has(channel))];
  }, [channels, recentChannels]);
  const maxPageIndex = Math.max(0, Math.ceil(orderedChannels.length / histogramPageSize) - 1);
  const startIndex = pageIndex * histogramPageSize;
  const visibleHistogramChannels = orderedChannels.slice(startIndex, startIndex + histogramPageSize);

  useEffect(() => {
    if (pageIndex > maxPageIndex) {
      setPageIndex(maxPageIndex);
    }
  }, [maxPageIndex, pageIndex]);

  const updateRecentChannels = (channelNumber: number) => {
    setRecentChannels((prev) => [channelNumber, ...prev.filter((channel) => channel !== channelNumber)].slice(0, 4));
    setPageIndex(0);
  };

  const openModal = (channelNumber: number) => {
    setSelectedChannel(channelNumber);
    setModalOpen(true);
  };

  const onRateMapSelectChannel = (channelNumber: number) => {
    updateRecentChannels(channelNumber);
    openModal(channelNumber);
  };

  const clearRecentChannels = () => {
    setRecentChannels([]);
    setPageIndex(0);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedChannel(null);
  };

  const channelHasData = selectedChannel !== null && snapshot.channels.includes(selectedChannel);
  const modalChannel = selectedChannel ?? 0;
  const modalRate = snapshot.counts_by_channel[String(modalChannel)] ?? 0;

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
        channels: 64,
      }));
      const freshSnapshot = await fetch(`${backendUrl}/snapshot`).then((res) => res.json());
      setSnapshot(normalizeSnapshot(freshSnapshot));
      setPageIndex(0);
    } catch {
      setSettingsError("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const openMonitorWindow = () => {
    const monitorUrl = new URL(window.location.href);
    monitorUrl.searchParams.set("view", "monitor");
    window.open(monitorUrl.toString(), "quicklook-monitor", "popup=yes,width=1640,height=980");
  };

  if (viewMode === "monitor") {
    return <MonitorWall snapshot={snapshot} status={status} />;
  }

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
              <button
                type="button"
                className="status-open-monitor"
                onClick={openMonitorWindow}
                title="Open the secondary monitor wall in a separate window"
              >
                Open Monitor Wall ↗
              </button>
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
              <span>Aggregation Window (s)</span>
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
            {settingsError ? <span className="settings-error">{settingsError}</span> : null}
          </div>
        </div>
      </header>

      <main className="app-container dashboard-grid">
        <section className="panel counts-panel">
          <div className="panel-header">
            <div>
              <h2>Rate (Hz) per Channel</h2>
              <p className="subtitle">
                {channels.length} channels · linear scale · auto max ({formatRateMax(countsMax)} Hz)
              </p>
            </div>
          </div>
          <div className="bar-chart-64">
            {channels.map((ch) => {
              const count = snapshot.counts_by_channel[String(ch)] || 0;
              const height = (count / countsMax) * 100;
              return (
                <div key={ch} className="bar-item-64" title={`ch ${ch}: ${count} counts`}>
                  <div className="bar-track-64">
                    <div className="bar-64" style={{ height: `${height}%` }} />
                  </div>
                  {ch % 8 === 0 ? <span>ch {ch}</span> : <span className="bar-label-spacer" aria-hidden="true" />}
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
          </div>
          <RateMapPanel
            ratemap={snapshot.ratemap_8x8}
            heatMin={heatMin}
            heatMax={heatMax}
            onSelectChannel={onRateMapSelectChannel}
          />
        </section>

        <section className="panel histograms-panel">
          <div className="panel-header">
            <div>
              <h2>Histograms + Instant Rate Trend</h2>
              <p className="subtitle">
                4 channels view · Aggregation Window: {snapshot.window_s}s · {snapshot.t_start_us} →{" "}
                {snapshot.t_end_us} μs
              </p>
              {recentChannels.length > 0 ? (
                <div className="recency-indicator">
                  <span>Showing recent selections</span>
                  <button type="button" onClick={clearRecentChannels}>
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
            <div className="channel-nav">
              <button type="button" onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}>
                ↑
              </button>
              <span>
                {startIndex + 1}-{Math.min(startIndex + histogramPageSize, orderedChannels.length)} / {orderedChannels.length}
              </span>
              <button
                type="button"
                onClick={() => setPageIndex((prev) => Math.min(maxPageIndex, prev + 1))}
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
                        onClick={() => {
                          updateRecentChannels(ch);
                          openModal(ch);
                        }}
                      >
                        <MiniPlotChart
                          kind="histogram"
                          data={data}
                          showXAxisLabel={isLastRow}
                          showYAxisLabel={streamIndex === 0}
                        />
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="mini-plot"
                    onClick={() => {
                      updateRecentChannels(ch);
                      openModal(ch);
                    }}
                  >
                    <MiniPlotChart
                      kind="line"
                      data={snapshot.rate_history[String(ch)] ?? []}
                      showXAxisLabel={isLastRow}
                      showYAxisLabel={rowIndex === 0}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

      </main>

      <ChannelDetailModal
        open={modalOpen}
        channel={selectedChannel}
        windowS={snapshot.window_s}
        tStartUs={snapshot.t_start_us}
        tEndUs={snapshot.t_end_us}
        rateHz={modalRate}
        adcX={snapshot.histograms.adc_x[String(modalChannel)] ?? Array(64).fill(0)}
        adcGtop={snapshot.histograms.adc_gtop[String(modalChannel)] ?? Array(64).fill(0)}
        adcGbot={snapshot.histograms.adc_gbot[String(modalChannel)] ?? Array(64).fill(0)}
        rateTrend={snapshot.rate_history[String(modalChannel)] ?? []}
        hasData={channelHasData}
        onClose={closeModal}
      />
    </div>
  );
}

function MonitorWall({
  snapshot,
  status,
}: {
  snapshot: Snapshot;
  status: Status;
}) {
  const [plotMode, setPlotMode] = useState<MultiChannelPlotMode>("adc_x");
  const [focusedChannelIndex, setFocusedChannelIndex] = useState<number | null>(null);
  const [focusedMode, setFocusedMode] = useState<MultiChannelPlotMode>("adc_x");
  const [lockedYAxisByMode, setLockedYAxisByMode] = useState<Record<MultiChannelPlotMode, number>>({
    adc_x: 1,
    adc_gtop: 1,
    adc_gbot: 1,
    rate_vs_time: 1,
  });
  const channels = snapshot.channels.length > 0 ? snapshot.channels : defaultChannels;

  useEffect(() => {
    setLockedYAxisByMode((prev) => ({
      ...prev,
      [plotMode]: prev[plotMode] > 1 ? prev[plotMode] : getModeYAxisMax(snapshot, plotMode, channels),
    }));
  }, [channels, plotMode, snapshot]);

  const currentYAxisMax = lockedYAxisByMode[plotMode];
  const focusedYAxisMax = lockedYAxisByMode[focusedMode];

  const modeMeta: Record<MultiChannelPlotMode, { title: string; subtitle: string }> = {
    adc_x: { title: "ADC_X", subtitle: "Histogram of counts vs ADC units" },
    adc_gtop: { title: "ADC_GTOP", subtitle: "Histogram of counts vs ADC units" },
    adc_gbot: { title: "ADC_GBOT", subtitle: "Histogram of counts vs ADC units" },
    rate_vs_time: { title: "Rate vs Time", subtitle: "Line series in Hz over rolling windows" },
  };

  const openFocusedChart = (index: number) => {
    setFocusedChannelIndex(index);
    setFocusedMode(plotMode);
  };

  const closeFocusedChart = () => {
    setFocusedChannelIndex(null);
  };

  const goToPreviousChannel = () => {
    if (focusedChannelIndex === null) {
      return;
    }
    const previousIndex = (focusedChannelIndex - 1 + channels.length) % channels.length;
    setFocusedChannelIndex(previousIndex);
  };

  const goToNextChannel = () => {
    if (focusedChannelIndex === null) {
      return;
    }
    const nextIndex = (focusedChannelIndex + 1) % channels.length;
    setFocusedChannelIndex(nextIndex);
  };

  const focusedChannel = focusedChannelIndex === null ? null : channels[focusedChannelIndex];

  return (
    <div className="monitor-app">
      <header className="monitor-header">
        <div>
          <p className="monitor-kicker">Quicklook Monitor Window</p>
          <h1>64-Channel Multi-Plot Wall</h1>
          <p>
            Live secondary display for operations · {channels.length} detected channels · {modeMeta[plotMode].title}
          </p>
        </div>
        <div className="monitor-controls">
          <label>
            Visualization Mode
            <select value={plotMode} onChange={(event) => setPlotMode(event.target.value as MultiChannelPlotMode)}>
              <option value="adc_x">All ADC_X</option>
              <option value="adc_gtop">All ADC_GTOP</option>
              <option value="adc_gbot">All ADC_GBOT</option>
              <option value="rate_vs_time">All Rate vs Time</option>
            </select>
          </label>
          <div className="monitor-status-pill">
            <span className={status.connected ? "dot ok" : "dot warn"} />
            <strong>{status.connected ? "Connected" : "Disconnected"}</strong>
            <span className={status.running ? "pill running" : "pill stopped"}>{status.running ? "Running" : "Stopped"}</span>
          </div>
        </div>
      </header>

      <section className="monitor-meta-card">
        <span>{modeMeta[plotMode].subtitle}</span>
        <span>
          Window: {snapshot.window_s}s · Snapshot range: {snapshot.t_start_us} → {snapshot.t_end_us} μs
        </span>
      </section>

      <main className="monitor-grid">
        {channels.map((channel, index) => {
          const isRate = plotMode === "rate_vs_time";
          const chartData = isRate
            ? snapshot.rate_history[String(channel)] ?? []
            : snapshot.histograms[plotMode][String(channel)] ?? Array(64).fill(0);

          return (
            <article
              key={channel}
              className="monitor-card"
              onClick={() => openFocusedChart(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openFocusedChart(index);
                }
              }}
            >
              <div className="monitor-card-header">
                <h3>Channel {channel}</h3>
                <span>{(snapshot.counts_by_channel[String(channel)] ?? 0).toFixed(2)} Hz</span>
              </div>
              <div className="monitor-card-chart">
                {isRate ? (
                  <MiniPlotChart kind="line" data={chartData} yMax={currentYAxisMax} showXAxisLabel showYAxisLabel />
                ) : (
                  <MiniPlotChart kind="histogram" data={chartData} yMax={currentYAxisMax} showXAxisLabel showYAxisLabel />
                )}
              </div>
            </article>
          );
        })}
      </main>

      <MonitorChartModal
        open={focusedChannel !== null}
        channel={focusedChannel}
        mode={focusedMode}
        onChangeMode={setFocusedMode}
        countsHz={focusedChannel === null ? 0 : snapshot.counts_by_channel[String(focusedChannel)] ?? 0}
        adcX={focusedChannel === null ? [] : snapshot.histograms.adc_x[String(focusedChannel)] ?? []}
        adcGtop={focusedChannel === null ? [] : snapshot.histograms.adc_gtop[String(focusedChannel)] ?? []}
        adcGbot={focusedChannel === null ? [] : snapshot.histograms.adc_gbot[String(focusedChannel)] ?? []}
        rateTrend={focusedChannel === null ? [] : snapshot.rate_history[String(focusedChannel)] ?? []}
        yMax={focusedYAxisMax}
        onClose={closeFocusedChart}
        onPrevious={goToPreviousChannel}
        onNext={goToNextChannel}
      />
    </div>
  );
}

function MonitorChartModal({
  open,
  channel,
  mode,
  onChangeMode,
  countsHz,
  adcX,
  adcGtop,
  adcGbot,
  rateTrend,
  yMax,
  onClose,
  onPrevious,
  onNext,
}: {
  open: boolean;
  channel: number | null;
  mode: MultiChannelPlotMode;
  onChangeMode: (mode: MultiChannelPlotMode) => void;
  countsHz: number;
  adcX: number[];
  adcGtop: number[];
  adcGbot: number[];
  rateTrend: number[];
  yMax: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowLeft") {
        onPrevious();
      }
      if (event.key === "ArrowRight") {
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onNext, onPrevious, open]);

  if (!open || channel === null) {
    return null;
  }

  const isRate = mode === "rate_vs_time";
  const chartData =
    mode === "adc_x" ? adcX : mode === "adc_gtop" ? adcGtop : mode === "adc_gbot" ? adcGbot : rateTrend;

  return (
    <div className="monitor-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <article className="monitor-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="monitor-modal-close" onClick={onClose}>
          ×
        </button>
        <header className="monitor-modal-header">
          <div>
            <h2>Channel {channel}</h2>
            <p>{countsHz.toFixed(2)} Hz · Expanded monitor view</p>
          </div>
          <label>
            Visualization Mode
            <select value={mode} onChange={(event) => onChangeMode(event.target.value as MultiChannelPlotMode)}>
              <option value="adc_x">ADC_X</option>
              <option value="adc_gtop">ADC_GTOP</option>
              <option value="adc_gbot">ADC_GBOT</option>
              <option value="rate_vs_time">Rate vs Time</option>
            </select>
          </label>
        </header>
        <div className="monitor-modal-chart">
          {isRate ? (
            <MiniPlotChart kind="line" data={chartData} yMax={yMax} showXAxisLabel showYAxisLabel />
          ) : (
            <MiniPlotChart kind="histogram" data={chartData} yMax={yMax} showXAxisLabel showYAxisLabel />
          )}
        </div>
        <footer className="monitor-modal-footer">
          <button type="button" onClick={onPrevious}>
            ← Previous
          </button>
          <span>Use ← / → keys to navigate</span>
          <button type="button" onClick={onNext}>
            Next →
          </button>
        </footer>
      </article>
    </div>
  );
}

function RateMapPanel({
  ratemap,
  heatMin,
  heatMax,
  onSelectChannel,
}: {
  ratemap: number[][];
  heatMin: number;
  heatMax: number;
  onSelectChannel: (channelNumber: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);

  const layout = useMemo(() => {
    const contentWidth = Math.max(0, size.width - 8);
    const contentHeight = Math.max(0, size.height - 42);
    const cellSize = Math.max(12, Math.floor(Math.min(contentWidth, contentHeight) / 8));
    const gridSize = cellSize * 8;
    return { cellSize, gridSize };
  }, [size.height, size.width]);

  return (
    <div ref={containerRef} className="heatmap-panel-body">
      <div className="heatmap-wrap" style={{ width: `${layout.gridSize}px` }}>
        <div
          className="heatmap"
          style={{
            gridTemplateColumns: `repeat(8, ${layout.cellSize}px)`,
            gridTemplateRows: `repeat(8, ${layout.cellSize}px)`,
          }}
        >
          {ratemap.map((row, rowIndex) =>
            row.map((value, colIndex) => {
              const color = hotColorScale(value, heatMin, heatMax);
              return (
                <button
                  key={`${rowIndex}-${colIndex}`}
                  type="button"
                  className="heat-cell"
                  style={{ backgroundColor: color }}
                  title={`ch ${rowIndex * 8 + colIndex}: ${value.toFixed(2)} Hz`}
                  onClick={() => onSelectChannel(rowIndex * 8 + colIndex)}
                >
                  {rowIndex * 8 + colIndex}
                </button>
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
    </div>
  );
}


export default App;
