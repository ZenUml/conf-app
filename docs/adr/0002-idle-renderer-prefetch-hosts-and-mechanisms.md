# 0002 — Idle renderer prefetch: hosts, mechanisms, and kill switch

Date: 2026-06-10
Status: accepted
Related: [docs/features/renderer-prefetch.md](../features/renderer-prefetch.md), EAG-64, PR #231

## Context

PR #231 lazy-loaded DrawIO, trading non-graph startup cost for a graph
cold-load regression (cold p90 ~15s; the bundle is ~4.2MB over 5 files). All
our iframes on a Confluence site share one CDN origin and HTTP cache per
deploy, so any iframe can warm the cache for all later renders. EAG-64
proposed using the `confluence:pageBanner` iframe (which mounts on every
page) as the warmer.

## Decisions

1. **Two hosts, not one.** Macro iframes warm at idle after their own render
   (safe: long-lived iframes, no close-timing risk; covers macro-page
   browsing). The page banner warms on its `'none'` fast-path (covers
   macro-free pages — EAG-64's core idea) but only when the once-per-deploy
   throttle says an attempt is due, holding `view.close()` behind an 8s
   deadline. A design review argued for deferring the banner host entirely
   because of the documented ~150px banner flicker risk; we keep it because
   it is the only macro-free-page coverage, but gate it behind its own flag
   (`renderer-prefetch-banner`) plus a live flicker verification before
   enabling. The banner fast-path stays two localStorage reads when not due.

2. **Throttle keys on the build commit, once per deploy per browser.** The
   cache is per-deploy (new `<bundle-hash>` CDN path every release), so
   re-warming once per deploy is exactly the cache's lifetime. Failed
   attempts are marked done too — this is an optimization; retry storms cost
   users bandwidth.

3. **Mechanism per bundle shape.**
   - Stable URLs (DrawIO `public/` files): `<link rel="prefetch">` —
     download-only, low priority. The list is exported from
     `loadDrawioViewer.ts` so prefetch and loader cannot drift.
   - Hashed Vite chunks (ZenUML, OpenAPI): a build plugin emits
     `dist/prefetch-manifest.json` (entry-family chunks + static import
     closure); runtime link-prefetches the listed paths. We chose this over
     enabling `build.manifest` (full manifest is much larger and exposes
     internals) and over import()-warming 3.5MB of JS (CPU/memory cost in a
     foreign iframe).
   - Mermaid: import-warm via the real `loadMermaid()` singleton, because a
     link prefetch of the ESM entry would not fetch its static-import
     chunks. Entry+core is ~30KB; per-type chunks stay lazy.
   - PlantUML: server-rendered, nothing to prefetch.

4. **Kill switch via `/api/features` KV fetched with `callRemote`.** Inside
   Forge CDN iframes, `window.location.origin` is the CDN host, so
   `FeatureService.ts` (which fetches that origin) cannot work and is in
   fact dormant (zero callers). `callRemote` → Forge remote → Cloudflare is
   the path every backend call already uses, bills no Forge GB-seconds, and
   is variant-neutral. Results are memoized 6h in localStorage so the
   flag-off steady state costs zero network; fail-closed.

## Consequences

- `macro_viewed.cache_state` is the success metric; no new render-time
  instrumentation.
- Each release re-colds the cache and triggers one re-warm (~4–8MB) per
  active browser; release cadence multiplies bandwidth, bounded per browser.
- Two flags must be seeded in each variant's KV before anything activates;
  shipped dark by default.
- If a refactor renames the `zenuml.esm-*` / `forge-swagger-ui-*` /
  `OpenApiViewer-*` chunk families, the manifest silently drops them — the
  build-verification step in the feature doc is the guard.
