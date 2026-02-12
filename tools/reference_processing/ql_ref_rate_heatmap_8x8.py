#!/usr/bin/env python3
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

TIME_TICKS_PER_SEC = 10_000_000


def correct_time_ticks(raw_time: np.ndarray) -> np.ndarray:
    raw_time = raw_time[np.isfinite(raw_time)]
    if raw_time.size == 0:
        return raw_time
    corrected_time = np.empty_like(raw_time, dtype=np.float64)
    offset_ticks = 0.0
    corrected_time[0] = raw_time[0]
    for i in range(1, raw_time.size):
        if raw_time[i] < 0.1 * raw_time[i - 1]:
            offset_ticks += TIME_TICKS_PER_SEC
        corrected_time[i] = raw_time[i] + offset_ticks
    return corrected_time


def duration_seconds(time_ticks: np.ndarray) -> float:
    time_ticks = time_ticks[np.isfinite(time_ticks)]
    if time_ticks.size == 0:
        return float("nan")
    corrected = correct_time_ticks(time_ticks)
    if corrected.size == 0:
        return float("nan")
    tmin = float(np.nanmin(corrected))
    tmax = float(np.nanmax(corrected))
    if not np.isfinite(tmin) or not np.isfinite(tmax) or tmax <= tmin:
        return float("nan")
    return (tmax - tmin) / TIME_TICKS_PER_SEC


def compute_rates(df: pd.DataFrame, per_channel: bool) -> dict[int, float]:
    counts = df["channel"].value_counts().to_dict()
    rates = {}
    if per_channel:
        for ch, n in counts.items():
            dt = duration_seconds(df[df["channel"] == ch]["timestamp_24"].to_numpy())
            rates[int(ch)] = n / dt if np.isfinite(dt) and dt > 0 else float("nan")
    else:
        dt = duration_seconds(df["timestamp_24"].to_numpy())
        if not np.isfinite(dt) or dt <= 0:
            dt = float("nan")
        for ch, n in counts.items():
            rates[int(ch)] = n / dt if np.isfinite(dt) else float("nan")
    return rates


def build_grid(values: dict[int, float], nrows: int = 8, ncols: int = 8) -> np.ndarray:
    grid = np.full((nrows, ncols), np.nan, dtype=np.float64)
    for ch in range(nrows * ncols):
        if ch in values:
            r = ch // ncols
            c = ch % ncols
            grid[r, c] = values[ch]
    return grid


def plot_heatmap(grid: np.ndarray, title: str, out: str | None, vmin: float | None, vmax: float | None):
    mask = np.isnan(grid)
    labels = np.empty_like(grid, dtype=object)
    for r in range(grid.shape[0]):
        for c in range(grid.shape[1]):
            ch = r * grid.shape[1] + c
            labels[r, c] = f"ch{ch}"
    fig, ax = plt.subplots(figsize=(8, 7))
    sns.heatmap(
        grid,
        mask=mask,
        ax=ax,
        cmap="YlOrRd",
        square=True,
        linewidths=1.0,
        linecolor="black",
        cbar_kws={"label": "Count rate (Counts/second)"},
        vmin=vmin,
        vmax=vmax,
        annot=False,
    )
    for r in range(grid.shape[0]):
        for c in range(grid.shape[1]):
            ax.text(c + 0.5, r + 0.5, labels[r, c], ha="center", va="center", fontsize=8)
    ax.set_xlabel("")
    ax.set_ylabel("")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(f"Data file: {title}")
    fig.tight_layout()
    if out:
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out, dpi=200, bbox_inches="tight")
        print(f"Wrote {out}")
    else:
        plt.show()


def main():
    ap = argparse.ArgumentParser(
        description="Plot 8x8 heatmap of count rate per channel (0-63)."
    )
    ap.add_argument("parquet", help="Input Parquet file")
    ap.add_argument("--out", default=None, help="Output image file (e.g., rate_heatmap.png)")
    ap.add_argument("--per-channel", action="store_true", help="Compute duration per channel instead of global")
    ap.add_argument("--vmin", type=float, default=None, help="Lower color scale bound")
    ap.add_argument("--vmax", type=float, default=None, help="Upper color scale bound")
    args = ap.parse_args()

    df = pd.read_parquet(args.parquet)
    if "no_data" in df.columns:
        df = df[df["no_data"] == 0]
    for col in ["channel", "timestamp_24"]:
        if col not in df.columns:
            raise ValueError(f"Missing required column '{col}' in Parquet.")

    rates = compute_rates(df, per_channel=args.per_channel)
    grid = build_grid(rates, nrows=8, ncols=8)
    title = Path(args.parquet).stem
    plot_heatmap(grid, title=title, out=args.out, vmin=args.vmin, vmax=args.vmax)


if __name__ == "__main__":
    main()
