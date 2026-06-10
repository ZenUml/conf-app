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
`throttle.ts` (deploy-keyed done-key + best-effort lock), `flags.ts` (kill
switch), `prefetchAssets.ts` (`<link rel="prefetch">` injection + hashed-chunk
manifest fetch).

### Hosts

| Host | Where wired | When it runs |
|---|---|---|
| `macro` | `trackRenderTime.ts` — after `macro_viewed` is emitted | `requestIdleCallback` after a macro render settles; warms the OTHER renderer families (the calling iframe's own family is excluded) |
| `banner` | `forgeIndex.ts` — `zenuml-page-banner` `'none'` fast-path | Only when the cheap sync due-check passes (≤1 per deploy per browser); holds `view.close()` up to an 8s deadline. This is the only surface that covers **macro-free** pages. |

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

### Kill switch / rollout

Flags in the existing `/api/features` KV JSON (`functions/api/features.ts`),
fetched via `callRemote` (Forge remote → Cloudflare backend — the only fetch
path that works inside Forge CDN iframes; `FeatureService.ts` fetches the CDN
origin and is dormant — do not use it for iframe-side flags):

- `renderer-prefetch` — master, gates the macro host
- `renderer-prefetch-banner` — banner host (requires master too)

Evaluated client-side (`enabled` + `rules.domains.include/exclude` +
`rules.default`) against `getClientDomain()`. Result memoized in localStorage
for 6h — so flag-off costs zero network after the first check, and kill
latency is ≤6h for browsers that already memoized "on". Fail-closed on any
fetch error. Flag-off attempts are NOT marked done, so a later flag flip
still warms.

Rollout: ship dark (flags absent = off) → add flags to each variant's KV with
`default:false` + canary `domains.include` → watch monitoring (below) → flip
`default:true`. Kill: set `enabled:false` in KV.

```bash
# per Cloudflare Pages project (conf-lite / conf-full / ...): read-modify-write
# the feature_flags key in the confluence_plugin_features KV namespace, adding
#   renderer-prefetch        {enabled:true, rules:{domains:{include:[<canaries>]}, default:false}}
#   renderer-prefetch-banner {enabled:true, rules:{domains:{include:[<canaries>]}, default:false}}
```

### Analytics

`renderer_prefetch_started` / `renderer_prefetch_completed` (catalog.ts),
fired ONLY on an actual attempt (≤1 per deploy per browser — bounded volume,
never page-view scale; flag-off and throttled loads emit nothing).
Properties: `prefetch_host`, `prefetch_renderers`, `prefetch_outcome`
(completed/partial/failed), `prefetch_assets_count`, `prefetch_failed_count`,
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

## Live verification gates (before trusting the rollout)

- **CDN cache headers (load-bearing go/no-go)**: on a real deploy, check
  `Cache-Control`/`Age` of `<cdn-host>/<bundle-hash>/drawio/js/viewer-static.min.js`.
  If assets are `no-store`/`no-cache`, prefetch warms nothing and cache_state
  will not shift — stop and rethink.
- **Cross-iframe warm flip**: forge tunnel on lite-dev with the flag on for
  the tunnel domain: render a non-graph macro, then open a Graph page;
  DevTools should show `viewer-static.min.js` served from cache
  (transferSize≈0) and `macro_viewed.cache_state=warm`.
- **Banner empty-slot check (gates `renderer-prefetch-banner` only)**: with
  the banner flag on and the due-key cleared, confirm the held-open banner
  (≤8s) does not show a visible empty slot / layout shift vs immediate close
  (the ~150px flicker documented in [page-banner.md](page-banner.md)). If it
  flickers, leave the banner flag off — the macro host still covers
  macro-page browsing.

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
