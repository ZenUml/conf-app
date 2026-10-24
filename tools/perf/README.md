# Page-load measurement harness

Measures how long a Confluence page with ZenUML macros takes to load, **per macro iframe**,
under controlled cache and network conditions. Built for the 2026-07 PVT-Lite loading
investigation; reusable for any before/after comparison on lite-stg / lite-dev.

## What it measures

- `firstMacroMs` / `allMacrosMs` — navigation start → a macro iframe shows its **actual
  rendered diagram** (size-gated DOM probe: viewer-chrome icon SVGs are 16–20px, real
  diagrams ≥100px; type-specific selectors for zenuml `.sequence-diagram` and swagger).
- Main-frame `TTFB` / `DCL` / `load` / buffered `LCP` (Confluence shell).
- Per-frame `PerformanceResourceTiming` (transfer/encoded sizes, timing, protocol),
  full request log with ms offsets, decoded Mixpanel `/track` payloads
  (`macro_viewed` → `fetch_ms` / `render_ms`), console error count, cache-hit ratio.

## Conditions

- `--cache cold` — CDP `Network.clearBrowserCache` before each run (cookies/localStorage
  persist: "returning user with evicted cache"). `warm` — one discarded priming load first.
- `--throttle fast4g` — Chrome DevTools "Fast 4G" preset via CDP per target
  (9 Mbps ×0.9 down, 1.5 Mbps ×0.9 up, 165 ms applied latency).

## Usage

```bash
# single condition
node tools/perf/measure-page-load.mjs \
  --url "https://lite-stg.atlassian.net/wiki/spaces/SD/pages/139460609/PVT+Lite+perf+replica" \
  --label stg-none-cold --throttle none --cache cold --runs 3 --expect 5 \
  --out /tmp/perf-results/stg --storage /path/to/storage-state.json

# full 4-condition matrix
STORAGE_STATE=/path/to/storage-state.json \
  tools/perf/run-matrix.sh "<pageUrl>" /tmp/perf-results/stg 5 stg

# aggregate runs into per-condition medians / per-origin bytes / key-asset + API timings
python3 tools/perf/analyze-runs.py /tmp/perf-results/stg
```

`--expect N` = number of Lite macro frames that must render before the run settles
(paywall banner and non-Lite embeds are recorded but excluded from the KPI).
`storage-state.json` is a Playwright `storageState` export with logged-in Atlassian
cookies — **never commit it**.

## Reference pages (5 Lite macros: plantuml, mermaid, graph, zenuml-sequence, openapi)

- prod:     https://zenuml.atlassian.net/wiki/spaces/ZEN/pages/1806270487/PVT+Lite
- lite-stg: https://lite-stg.atlassian.net/wiki/spaces/SD/pages/139460609/PVT+Lite+perf+replica
- lite-dev: https://lite-dev.atlassian.net/wiki/spaces/SD/pages/41058305/PVT+Lite+perf+replica

The replicas were cloned from the prod page (same custom-content bodies, env-swapped ADF).
Deltas vs prod: no AsyncAPI-app macro, no other-app iframes.

## Caveats

- Throttling attaches to OOPIF targets on `frameattached`, so each iframe's initial HTML
  document may escape throttling; all iframe subresources are throttled.
- Runs are headed (real rendering path). Keep the machine otherwise idle during a matrix —
  CPU/network contention skews results.
- Warm runs report `cacheHitRatio` ≈ 1.0; verify it before trusting a warm number.
- Playwright MCP cannot do any of this (CDP is blocked there); run this standalone script.
