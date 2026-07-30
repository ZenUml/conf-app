# Behavior-Preserving Viewer Load Refactor

**Date:** 2026-07-31  
**Status:** Ready for review

## Context

PR #423 attempted to put every plain viewer behind a new lifecycle state
machine. Against `main`, that implementation adds 852 net production lines and
also changes analytics, cache identity, renderer reporting, error handling, and
load completion semantics.

This replacement design treats current `main` behavior as the contract. The
refactor is worthwhile only where two implementations already perform the same
operation in the same order. Viewer-specific sequencing stays viewer-specific.

## Goals

- Preserve the current behavior of Sequence, Mermaid, PlantUML, Graph, OpenAPI,
  and Embed viewers.
- Remove the duplicated background SWR revalidation algorithm shared by
  `forgeIndex.ts` and `viewerBootstrap.ts`.
- Keep the production-code diff at net zero or below.
- Make each production change explainable as an extraction or deletion, not a
  new capability.

## Non-goals

- A single state machine for all viewer families.
- New lifecycle states, target-resolution adapters, render revisions, or
  renderer reporters.
- Changes to `macro_viewed`, its timing milestone, event properties, or
  deduplication behavior.
- Changes to the content-cache namespace, key, format, validation, eviction,
  or corruption handling.
- Changes to paywall, viewport-gate, mounting, recovery, snapshot, attachment,
  or error-handling behavior.
- Moving viewer-specific content resolution out of its current entry point.

## Design

### Preserve the two real orchestration shapes

`viewerBootstrap.ts` remains the orchestrator for Graph, OpenAPI, and Embed.
It continues to own their context initialization, fullscreen paywall ordering,
loading-shell mount, timed fetch, publication, and `afterLoad` behavior.

`forgeIndex.ts` remains the orchestrator for Sequence, Mermaid, and PlantUML.
It continues to own its editor/viewer split, viewport gate, recovery chain,
snapshot scheduling, and final mount.

These paths are deliberately not forced through one configurable lifecycle:
their observable ordering differs. In particular, the dedicated-viewer cache
path mounts before starting revalidation, while the sequence-family path starts
revalidation before its potentially viewport-delayed mount.

### Extract only background revalidation

Add one small helper at
`src/utils/renderCache/revalidateViewerContent.ts` for the common cache-hit
background operation. Its inputs are callbacks, not domain adapters:

```ts
interface RevalidateViewerContentOptions {
  customContentId: string;
  cachedHash: string;
  loadFresh: () => Promise<Diagram | undefined>;
  onChanged: (fresh: Diagram) => void | Promise<void>;
  afterFresh?: (fresh: Diagram) => void | Promise<void>;
}
```

The helper reproduces the existing common sequence exactly:

1. Run `loadFresh`.
2. Return without changing the displayed cached document when it yields no
   document.
3. Serialize and store the fresh raw document under the existing ID-only key.
4. Compare its hash with the cached hash.
5. Invoke `onChanged` only when the hash differs.
6. Await `afterFresh`, when provided.
7. Catch the entire background operation and keep the cached render standing,
   using the existing warning.

Timing remains at the call site. Dedicated viewers pass a `loadFresh` callback
wrapped in their existing `renderPerf.time('fetch', ...)`; the sequence-family
path passes its existing untimed revalidation fetch. This avoids silently
changing analytics.

Viewer-specific work remains in caller callbacks:

- Sequence-family `loadFresh` retains orphan reporting and snapshot scheduling;
  `onChanged` retains `content_source = fetch`, PlantUML defaulting, and the
  viewport-gated remount.
- Dedicated viewers retain `loadDiagram`; `onChanged` retains publication;
  `afterFresh` retains the existing awaited `afterLoad` callback.

No helper is introduced for cache-hit mounting or initial fresh loading because
their ordering and side effects are not identical.

## Compatibility contract

The final diff must retain all of the following from `main`:

- `contentCacheStore` keeps the `zenuml:ccache:` namespace and
  `customContentId` key.
- Renderers continue to call `trackRenderTime` directly.
- `macro_viewed` keeps its current fields and timing semantics.
- `diagramLoadComplete` remains the Embed/OpenAPI load-completion signal.
- Dedicated-viewer cache hits keep the order: mount, publish, mark cache source,
  start background revalidation.
- Sequence-family cache hits keep the order: mark cache source, start
  background revalidation, await the viewport gate, mount.
- Fresh-load and background `afterLoad` calls remain awaited where they are
  awaited on `main`.
- Existing missing-content, thrown-error, compressed-Graph, orphan, legacy
  property, legacy UUID, snapshot, AutoConvert, paywall, and viewport behavior
  stays unchanged.

## Testing

- Restore the existing `main` tests as the baseline.
- Add characterization assertions only where current ordering is not already
  covered: dedicated cache-hit ordering and sequence cache-hit ordering.
- Unit-test the extracted helper for empty, unchanged, changed, callback, and
  rejected-load cases.
- Run the focused viewer/bootstrap/cache suites, then the full unit suite.
- Build Lite, Full, Diagramly, and AsyncAPI because the touched entry points
  are shared across variants.
- Do not claim UI verification without Playwright evidence.

## Acceptance

- No analytics catalog/type changes.
- No store, renderer, mount-root, or paywall changes.
- No viewer adapter directory, lifecycle state module, or render reporter.
- Production code is net zero or negative against the merge base.
- Existing behavior tests pass, including the new ordering characterizations.
- All four production builds pass.
