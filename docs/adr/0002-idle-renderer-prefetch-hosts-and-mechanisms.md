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
   deadline (+2s straggler grace; the flag fetch and Mermaid warm share the
   budget, so 10s is the hard worst case). A design review argued for deferring the banner host entirely
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

4. **Kill switch via Forge feature flags (client SDK).** Superseded the
   original `/api/features` KV + `callRemote` approach (shipped in PR #249,
   replaced before any flag was ever seeded): the `@forge/bridge ≥ 5.15`
   `FeatureFlags` client downloads config once at `initialize()` and
   `checkFlag()` evaluates locally — no Forge Function invocation (the
   quickstart's `invoke('getFlagValue')` resolver pattern is explicitly
   avoided: it would bill GB-seconds), no dependency on our Cloudflare
   backend, native per-site (`installContext`) + percentage + per-environment
   targeting, and instant Developer Console toggles instead of wrangler KV
   read-modify-writes per variant project. Fail-closed on missing
   installContext (standalone dev), init errors, and absent flags. The 6h
   localStorage memo was dropped — the once-per-deploy throttle already
   bounds evaluation volume, and fresh reads make Console kills take effect
   on the next attempt. (`FeatureService.ts` remains dormant — its
   `window.location.origin` fetch cannot work inside Forge CDN iframes.)

## Consequences

- `macro_viewed.cache_state` is the success metric; no new render-time
  instrumentation.
- Each release re-colds the cache and triggers one re-warm (~4–8MB) per
  active browser; release cadence multiplies bandwidth, bounded per browser.
- Two flags must be created in each app's Developer Console (lite, full,
  diagramly are separate Forge apps) before anything activates; shipped dark
  by default.
- If a refactor renames the `zenuml.esm-*` / `forge-swagger-ui-*` /
  `OpenApiViewer-*` chunk families, the manifest silently drops them — the
  build-verification step in the feature doc is the guard.
