#!/usr/bin/env python3
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Each tuple: (title label, DataFrame column, event flag)
SIGNALS = [
    ("X_top",      "adc_x",        0),    # X detector ADC values
    ("Gamma_top",  "adc_gtop",     1),    # Gamma top ADC values
    ("Gamma_bot",  "adc_gbot",     1),    # Gamma bottom ADC values
    ("Count rate (bin=10s)", "timestamp_24", None), # Counts per 10 s
]

TIME_TICKS_PER_SEC = 10_000_000
COUNT_RATE_BIN_SEC = 10

def calc_bins(x: np.ndarray) -> int:
    x = x[np.isfinite(x)]
    if x.size == 0:
        return 1
    bins = int(x.max() - x.min())
    return max(1, bins)


def make_count_rate(time_ticks: np.ndarray):
    time_ticks = time_ticks[np.isfinite(time_ticks)]
    if time_ticks.size == 0:
        return np.array([]), np.array([])

    tmin = float(time_ticks.min())
    tmax = float(time_ticks.max())
    bin_ticks = TIME_TICKS_PER_SEC * COUNT_RATE_BIN_SEC
    edges = np.arange(tmin, tmax + bin_ticks, bin_ticks)
    if edges.size < 2:
        edges = np.array([tmin, tmin + bin_ticks])
    counts, edges = np.histogram(time_ticks, bins=edges)
    centers_ticks = 0.5 * (edges[:-1] + edges[1:])
    centers_sec = centers_ticks / TIME_TICKS_PER_SEC
    return centers_sec, counts


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




def plot_grid(df: pd.DataFrame, out: str | None, parquet: str | None = None):

    
    
    if "no_data" in df.columns:
        df = df[df["no_data"] == 0]

    
    for col in ["channel", "is_g_event", "adc_x", "adc_gtop", "adc_gbot", "timestamp_24"]:
        if col not in df.columns:
            raise ValueError(f"Missing required column '{col}' in Parquet.")

    
    dets = sorted(df["channel"].dropna().astype(int).unique().tolist())
    if not dets:
        raise ValueError("No detectors found in 'channel'.")

   

    det_summary = {}
    for det in dets:
        ddet = df[df["channel"] == det]
        n_counts = int(len(ddet))
        det_summary[det] = n_counts

    
    n_det, n_sig = len(dets), len(SIGNALS)
    fig, axes = plt.subplots(
        nrows=n_sig, ncols=n_det,
        figsize=(4.0 * n_det, 2.8 * n_sig),
        sharey=False, squeeze=False
    )
    if parquet:
        title = Path(parquet).stem
    elif out:
        title = Path(out).stem
    else:
        title = "Spectra grid"
    fig.suptitle(title, fontsize=14)
    

    
    
    for c, det in enumerate(dets):
        n_counts = det_summary[det]
        col_label = f"Det {det} — N={n_counts:,}"

        for r, (sig_label, col_name, want_g) in enumerate(SIGNALS):
            ax = axes[r, c]

            
            dsub = df[(df["channel"] == det)]  

            if want_g == 1:
                dsub = dsub[dsub["is_g_event"] == 1]
            elif want_g == 0:
                dsub = dsub[dsub["is_g_event"] == 0]

            ax.grid(True, which="both", linestyle="--", linewidth=0.5)

            if col_name == "timestamp_24":
                raw_time = dsub[col_name].to_numpy()
                corrected_time = correct_time_ticks(raw_time)
                centers_sec, counts = make_count_rate(corrected_time)
                if counts.size > 0:
                    ax.step(centers_sec, counts, where="mid")
                    xmin = float(centers_sec.min())
                    xmax = float(centers_sec.max())
                    if np.isfinite(xmin) and np.isfinite(xmax) and xmin != xmax:
                        ax.set_xlim(xmin, xmax)
                else:
                    ax.plot([], [])
                    ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
                    ax.set_ylim(0, 1)
            else:
                x = dsub[col_name].to_numpy()
                bins = calc_bins(x)

                if np.isfinite(x).any():
                    ax.hist(x[np.isfinite(x)], bins=bins, histtype="step")
                    xmin = float(np.nanmin(x))
                    xmax = float(np.nanmax(x))
                    if np.isfinite(xmin) and np.isfinite(xmax) and xmin != xmax:
                        ax.set_xlim(xmin, xmax)
                else:
                    ax.plot([], [])
                    ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
                    ax.set_ylim(0, 1)

            
            if r == n_sig - 1:
                ax.set_xlabel("Time (s)")
            elif r == n_sig - 2:
                ax.set_xlabel("Energy channel")
            if c == 0:
                ax.set_ylabel(sig_label)
            if r == 0:
                ax.set_title(col_label)

    
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
        description="Plot grid of spectra."
    )
    ap.add_argument("parquet", help="Input Parquet file")
    ap.add_argument("--out", default=None, help="Output image file (e.g., spectra_grid.png)")
    args = ap.parse_args()

    df = pd.read_parquet(args.parquet)
    plot_grid(df, args.out, args.parquet)

    
    plt.show()


if __name__ == "__main__":
    main()
