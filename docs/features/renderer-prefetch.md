# Idle renderer-bundle prefetch (EAG-64)

Warms the browser HTTP cache for heavy renderer bundles during idle page
views, so a later macro render hits a warm cache. The success metric needs no
new instrumentation: `macro_viewed.cache_state` (measured from Resource
Timing `transferSize` in `src/utils/analytics/trackRenderTime.ts`) flips
cold→warm when the prefetch worked.

Motivation: PR #231 made DrawIO lazy-load, fixing the startup tax for
non-graph macros but regressing graph cold loads (post-change baseline
2026-06-09: cold p50 4.8s / p90 ~15s; overall graph p90 +48%). The DrawIO
bundle is ~4.2MB across 5 files — by far the largest cold-load cost.

## How it works

Core: `src/utils/prefetch/` — `rendererPrefetch.ts` (orchestrator),
`throttle.ts` (deploy-keyed done-key + best-effort lock),
`prefetchAssets.ts` (`<link rel="prefetch">` injection + hashed-chunk
manifest fetch).

### Hosts

| Host | Where wired | When it runs |
|---|---|---|
| `macro` | `trackRenderTime.ts` — after `macro_viewed` is emitted | `requestIdleCallback` after a macro render settles; warms the OTHER renderer families (the calling iframe's own family is excluded) |
| `banner` | `forgeIndex.ts` — `zenuml-page-banner` `'none'` fast-path | Only when the cheap sync due-check passes (≤1 per deploy per browser); holds `view.close()` up to the 8s deadline (+2s straggler grace, 10s worst case); the Mermaid import-warm shares that budget. This is the only surface that covers **macro-free** pages. |

The banner fast-path stays byte-cheap on the ~99.9% of loads where the
prefetch is not due: two localStorage reads, then `view.close()` as before.

### Coverage

| Renderer | Mechanism | Why |
|---|---|---|
| DrawIO (graph) | `<link rel=prefetch>` of `DRAWIO_PREFETCH_ASSETS` (exported by `loadDrawioViewer.ts` — prefetch list derives from the load list, cannot drift) | 5 stable `public/` URLs, ~4.2MB, the documented pain |
| ZenUML (sequence) | `<link rel=prefetch>` of hashed chunks from `dist/prefetch-manifest.json` | 3.5MB `zenuml.esm-<hash>.js`; hashes only known at build time |
| OpenAPI | same manifest (`forge-swagger-ui-*` + `OpenApiViewer-*` chunk closure) | hashed chunks |
| Mermaid | **import-warm** through the real `loadMermaid()` singleton | a link prefetch of the entry would NOT fetch its static-import chunks; `import()` does. Entry+core only (~30KB) — per-diagram-type chunks stay lazy |
| PlantUML | N/A | server-rendered at plantuml.com; no local bundle |

`prefetch-manifest.json` is emitted by the `prefetch-manifest` plugin in
`vite.config.mjs` (entry-chunk families + static import closure + CSS). On
the dev server it doesn't exist; the fetch sees the SPA HTML fallback and the
module treats it as "no manifest" (only DrawIO + Mermaid are warmed locally).

### Throttle, guards, ordering

- **Once per deploy per browser profile**: done-key
  `zenuml:prefetch:done:<VITE_APP_COMMIT>` — a new deploy moves assets to a
  new CDN path anyway, so re-warming per deploy is exactly right. A failed
  attempt is also marked done (no retry storms; it's an optimization).
- **Best-effort lock** `zenuml:prefetch:lock` (60s staleness) against
  concurrent iframes; races are harmless (browser dedupes identical fetches).
- **Network guards**: skip silently on `saveData`, `effectiveType` slow-2g/2g,
  hidden document. `deviceMemory < 4` skips only the Mermaid import-warm
  (download-only link prefetch is still allowed). Absent APIs ⇒ allow.
- `<link rel="prefetch">` is deliberate (not preload): low priority,
  browser-discretionary, never competes with the page's own resources.

### Kill switch / rollout — RETIRED 2026-07-25

**There is no feature flag any more.** Prefetch is unconditional on every
variant. `renderer-prefetch` / `renderer-prefetch-banner` ran at Everyone/100%
in production on lite and diagramly from June 2026; the gate and
`utils/prefetch/flags.ts` were deleted, and the Console flags are deleted once
that release ships (deleting them earlier would have switched prefetch off,
since `checkFlag`'s default is `false`).

Two consequences worth stating plainly:

- **full and asyncapi never had these flags**, so they never prefetched.
  Retiring the gate turns prefetch on there for the first time, without a
  staged rollout — an accepted decision, not an oversight.
- **Disabling now requires a release.** The remaining runtime brakes are the
  `readGuards` checks (saveData, 2g/slow-2g, hidden tab, `deviceMemory` < 4 for
  the Mermaid import-warm) and the once-per-deploy throttle. If prefetch has to
  come back under a switch, re-add a flag module (see
  `utils/renderGate/flags.ts` for the current pattern) — and use the
  `@forge/bridge` client-side `FeatureFlags` SDK, NOT the quickstart's
  `invoke('getFlagValue')` pattern, which routes through a Forge Function
  resolver and bills GB-seconds.

### Analytics

`renderer_prefetch_started` / `renderer_prefetch_completed` (catalog.ts),
fired ONLY on an actual attempt (≤1 per deploy per browser — bounded volume,
never page-view scale; throttled loads emit nothing).
Properties: `prefetch_host`, `prefetch_renderers`, `prefetch_outcome`
(completed/partial/failed/timed_out), `prefetch_assets_count`, `prefetch_failed_count`,
`prefetch_duration_ms`, `effective_type`, `save_data`. Purely client-side
Mixpanel — zero Forge Functions GB-seconds.

## Monitoring

1. **cache_state shift** (the point of the feature): Mixpanel `macro_viewed`,
   filter `macro_type = graph`, breakdown by `cache_state`, compare the
   cold:warm ratio and `duration_ms` p50/p90 of cold vs warm before/after
   canary enable. Use `/rendering-perf` for the percentile queries.
2. **Attempt health**: `renderer_prefetch_completed` breakdown by
   `prefetch_outcome` and `prefetch_host`. High `failed` ⇒ asset list drift or
   CDN issues — investigate before widening rollout.
3. **Volume tripwires**: `renderer_prefetch_started` should be ≪ page-view
   scale (≈ unique browsers × deploys). A spike correlates with deploy
   cadence, not traffic. Forge Functions GB-seconds (Developer console) must
   stay flat — this feature adds no Forge Function calls.

## Live verification gates — VERIFIED on lite-dev (development env, 2026-06-10)

All three gates below were verified live against the deployed development app
on lite-dev (branch feat/forge-feature-flags, flags enabled for the
development environment only):

- **CDN cache headers: GO.** `drawio/js/viewer-static.min.js` served with
  `cache-control: max-age=1728000, s-maxage=1728000,
  stale-while-revalidate=86400, immutable` — 20-day immutable cache; prefetch
  warms it reliably.
- **Warm flip: CONFIRMED.** After a banner-host prefetch on a macro-free
  page, the Graph page loaded `viewer-static.min.js` with `transferSize=0,
  duration=19ms` (cold baseline on the same setup: ~780KB wire, ~2s).
- **Banner empty-slot: NO FLICKER.** Screenshots of the page top strip during
  the held-open prefetch (~4s in) and after (~30s) are pixel-identical — no
  reserved slot, no layout shift. Observation: the banner iframe node stays
  in the DOM (hidden) after `view.close()` on this path; no visual impact.
- **Flags: CONFIRMED** evaluating client-side in both macro and banner
  iframes (`[renderer-prefetch] flags development {macroHost: true,
  bannerHost: true}`), with the full 25-link prefetch (5 DrawIO + manifest
  chunk closure) and the done-key written. NOTE the context contract: Custom
  UI `getContext()` has NO `installContext` field — the install ARI must be
  constructed from `cloudId` and passed as an attribute (see flags.ts).

That verification ran with the flags scoped to `development`; production and
staging were dark at the time. Superseded — prefetch reached 100% in
production on lite/diagramly in June 2026 and is unconditional on all four
variants since the gate was retired (2026-07-25).

### Gate definitions (for re-verification after major changes)

- **CDN cache headers (load-bearing go/no-go)**: on a real deploy, check
  `Cache-Control`/`Age` of `<cdn-host>/<bundle-hash>/drawio/js/viewer-static.min.js`.
  If assets are `no-store`/`no-cache`, prefetch warms nothing and cache_state
  will not shift — stop and rethink.
- **Cross-iframe warm flip**: forge tunnel on lite-dev (no flag to enable —
  prefetch is unconditional; clear the done-key to make it due):
  render a non-graph macro, then open a Graph page;
  DevTools should show `viewer-static.min.js` served from cache
  (transferSize≈0) and `macro_viewed.cache_state=warm`.
- **Banner empty-slot check**: with the due-key cleared, confirm the held-open
  banner (≤10s worst case) does not show a visible empty slot / layout shift
  vs immediate close (the ~150px flicker documented in
  [page-banner.md](page-banner.md)). This used to be gated by
  `renderer-prefetch-banner`; with that flag retired, a flicker regression can
  only be switched off by a release, so treat this gate as release-blocking.

## Local verification

- Unit: `npx vitest run src/utils/prefetch src/utils/analytics`
- Browser mechanics: `pnpm start:local`, then from `tests/e2e-tests/`:
  `pnpm test:preview tests/viewer-preview-renderer-prefetch.spec.ts`
- Manifest: `pnpm build:lite && cat dist/prefetch-manifest.json` — both
  `sequence` and `openapi` families must be present (a chunk-rename refactor
  silently drops a family; this is the guard).

## Known limitations / v2

- Mermaid per-diagram-type chunks stay cold (only entry+core warmed).
- Users whose first-ever page IS a graph page get no warm benefit (nothing
  ran before it).
- Each deploy re-colds the cache; prefetch re-warms once per browser per
  deploy (~4–8MB). Watch this on high release-cadence weeks.
- Editor bundles (`Workspace`, `forge-swagger-editor`) are not prefetched —
  editing is interaction-initiated and pays its own cost.
