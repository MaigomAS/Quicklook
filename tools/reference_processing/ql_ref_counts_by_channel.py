#!/usr/bin/env python3
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt


def compute_counts(df: pd.DataFrame, n_channels: int = 64) -> np.ndarray:
    counts = np.zeros(n_channels, dtype=int)
    if "channel" not in df.columns:
        raise ValueError("Missing required column 'channel' in Parquet.")
    ch_vals = df["channel"].dropna().astype(int).to_numpy()
    ch_vals = ch_vals[(ch_vals >= 0) & (ch_vals < n_channels)]
    if ch_vals.size:
        binc = np.bincount(ch_vals, minlength=n_channels)
        counts[:n_channels] = binc[:n_channels]
    return counts


def plot_counts(counts: np.ndarray, title: str, out: str | None):
    x = np.arange(counts.size)
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.bar(x, counts, width=0.9, align="center")
    ax.set_xlabel("Channel")
    ax.set_ylabel("Counts")
    ax.set_xticks(x)
    ax.set_xlim(-0.5, counts.size - 0.5)
    ax.set_title(f"Data file: {title}")
    ax.grid(True, axis="y", linestyle="--", linewidth=0.5)
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
        description="Plot counts per channel for channels 0-63."
    )
    ap.add_argument("parquet", help="Input Parquet file")
    ap.add_argument("--out", default=None, help="Output image file (e.g., counts_per_channel.png)")
    args = ap.parse_args()

    df = pd.read_parquet(args.parquet)
    if "no_data" in df.columns:
        df = df[df["no_data"] == 0]

    counts = compute_counts(df, n_channels=64)
    title = Path(args.parquet).stem
    plot_counts(counts, title=title, out=args.out)


if __name__ == "__main__":
    main()
