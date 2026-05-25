#!/usr/bin/env python3
"""Forge install count + delta vs prior snapshots.

Usage:
    python3 check.py [lite|full|diagramly|all]

Stores per-variant snapshots in ~/.claude/cache/forge-installs/<variant>-<iso-ts>.tsv
and compares the latest one against snapshots from at least 1 day and 7 days ago
to compute add/remove deltas. First run for a variant has no baseline — it just
saves the snapshot and tells you to rerun later.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

VARIANTS = {
    "lite":      ("8ad26115-211f-4216-971b-0540f606303d", "ZenUML Diagrams and Open API Lite"),
    "full":      ("d9e4002b-120b-426b-834b-402a4a5adce7", "ZenUML Diagrams for Confluence"),
    "diagramly": ("01ede8b1-4e88-451a-b9ef-89eeef93afaf", "Diagramly For Confluence"),
}

ANSI = re.compile(r"\x1b\[[0-9;]*m")
CACHE_DIR = Path.home() / ".claude" / "cache" / "forge-installs"


def fetch(variant: str) -> list[dict]:
    """Run `forge install list` for the given variant and parse rows."""
    app_id, _ = VARIANTS[variant]
    env = os.environ.copy()
    env["APP_ID"] = app_id
    proc = subprocess.run(
        ["npx", "forge", "install", "list"],
        env=env, capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout)
        sys.exit(f"forge install list failed for {variant} (exit {proc.returncode})")
    cleaned = ANSI.sub("", proc.stdout)
    rows = []
    for line in cleaned.splitlines():
        # Forge's table separator is the box-drawing char │
        cols = [c.strip() for c in line.split("│")]
        # A data row has the env col (index 2) populated with a known value
        if len(cols) >= 7 and cols[2] in ("production", "staging", "development"):
            rows.append({
                "id": cols[1],
                "env": cols[2],
                "site": cols[3],
                "version": cols[5],
            })
    return rows


def save_snapshot(variant: str, rows: list[dict]) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    path = CACHE_DIR / f"{variant}-{ts}.tsv"
    with path.open("w") as f:
        for r in rows:
            f.write(f"{r['id']}\t{r['env']}\t{r['site']}\t{r['version']}\n")
    return path


def load_snapshot(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) >= 4:
            rows.append({"id": parts[0], "env": parts[1], "site": parts[2], "version": parts[3]})
    return rows


def find_prior_snapshot(variant: str, min_age_days: int, exclude: Path | None) -> Path | None:
    """Return the newest snapshot for `variant` at least `min_age_days` old.

    `exclude` lets us avoid picking the snapshot we just wrote.
    """
    cutoff = datetime.now() - timedelta(days=min_age_days)
    best = None
    for p in CACHE_DIR.glob(f"{variant}-*.tsv"):
        if exclude and p.resolve() == exclude.resolve():
            continue
        m = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})", p.name)
        if not m:
            continue
        ts = datetime.strptime(m.group(1), "%Y-%m-%dT%H-%M-%S")
        if ts <= cutoff and (best is None or ts > best[0]):
            best = (ts, p)
    return best[1] if best else None


def diff(current: list[dict], prior: list[dict]) -> tuple[list[dict], list[dict]]:
    cur_by_id = {r["id"]: r for r in current}
    prior_by_id = {r["id"]: r for r in prior}
    added = [cur_by_id[i] for i in cur_by_id if i not in prior_by_id]
    removed = [prior_by_id[i] for i in prior_by_id if i not in cur_by_id]
    return added, removed


def report_variant(variant: str) -> None:
    app_id, app_name = VARIANTS[variant]
    print(f"\n=== {variant}  ({app_name}, appId={app_id}) ===")
    rows = fetch(variant)
    snap = save_snapshot(variant, rows)

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["env"]] = counts.get(r["env"], 0) + 1
    total = sum(counts.values())
    print("  Current installs:")
    for e in ("production", "staging", "development"):
        print(f"    {e:<12}{counts.get(e, 0):>5}")
    print(f"    {'Total':<12}{total:>5}")

    for label, days in (("past 1 day", 1), ("past 7 days", 7)):
        prior_path = find_prior_snapshot(variant, days, exclude=snap)
        if prior_path is None:
            print(f"  Δ {label}: no baseline yet — snapshot saved, rerun in {days}d for a delta")
            continue
        prior_rows = load_snapshot(prior_path)
        added, removed = diff(rows, prior_rows)
        # Make the comparison time human-friendly
        m = re.search(r"(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})", prior_path.name)
        when = f"{m.group(1)} {m.group(2).replace('-', ':')}" if m else prior_path.name
        sign_added = f"+{len(added)}" if added else "0"
        sign_removed = f"-{len(removed)}" if removed else "0"
        net = len(added) - len(removed)
        net_sign = f"{net:+d}" if net != 0 else "0"
        print(f"  Δ {label}  (vs snapshot from {when}, net {net_sign}):")
        if added:
            print(f"    Added ({sign_added}):")
            for a in added:
                print(f"      + {a['env']:<12} {a['site']}")
        else:
            print(f"    Added: 0")
        if removed:
            print(f"    Removed ({sign_removed}):")
            for r in removed:
                print(f"      − {r['env']:<12} {r['site']}")
        else:
            print(f"    Removed: 0")


def main() -> None:
    args = sys.argv[1:] or ["all"]
    if "all" in args:
        variants = ["lite", "full", "diagramly"]
    else:
        variants = []
        for v in args:
            if v not in VARIANTS:
                sys.exit(f"Unknown variant: {v}; valid: lite | full | diagramly | all")
            variants.append(v)

    print(f"Snapshot dir: {CACHE_DIR}")
    for v in variants:
        try:
            report_variant(v)
        except subprocess.TimeoutExpired:
            print(f"\n=== {v} === timeout — large variant, rerun with longer timeout")


if __name__ == "__main__":
    main()
