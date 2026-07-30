# Unified Viewer Load Lifecycle

**Date:** 2026-07-30
**Status:** Approved; implementation in progress

## Context

At production baseline `1e5e8999`, the plain viewer load path is split across
two Implementations:

- `forgeIndex.ts` owns context resolution, content SWR, viewport gating,
  mounting, and background revalidation for Sequence, Mermaid, and PlantUML.
- `utils/viewerBootstrap.ts` owns a similar sequence for Graph, OpenAPI, and
  Embed, while each entry point separately supplies `loadDiagram` and a
  `resolveContentId` function that must agree with it.

This split has observable consequences:

- The Graph cache-hit path mounts synchronously before recording
  `content_source = swr_cache`, so `ForgeGraphViewer` can emit `macro_viewed`
  without the source property.
- `resolveContentId` and `loadDiagram` independently encode the same target
  rules. Embed duplicates saved-config, AutoConvert, same-site, and legacy
  fallback decisions across those paths.
- `NULL_DIAGRAM` plus `diagramLoadComplete` represents placeholder, empty, and
  failure states indirectly. A resolved `undefined` becomes terminal, but an
  exception handled by `onError` can return without publishing a terminal
  state.
- Render completion is reported by individual renderer components at different
  milestones, and the current timing source is mutable module state.

Draft PR #196 (`feat/error-panel`) is prior art for explicit viewer load state.
It remains open and unmerged, is based on a different change set, and includes a
much larger recovery-panel feature. This design reuses the useful state
distinction but neither merges nor duplicates that UI.

## Goals

- Put all six plain viewer families—Sequence, Mermaid, PlantUML, Graph,
  OpenAPI, and Embed—behind one deep load-lifecycle Module.
- Resolve Forge context and the content target once per load session.
- Make the SWR cache identity tenant-aware and macro-kind-aware.
- Represent loading, rendering, rendered, empty, and failed states explicitly.
- Give each content publication an immutable source/revision and report exactly
  one terminal `macro_viewed` per viewer session.
- Give `duration_ms` a documented, queryable v2 definition so it is not mixed
  silently with earlier timing definitions.
- Delete the duplicated lifecycle branches instead of wrapping and retaining
  them.

## Non-goals

- Changing editor initialization or persistence behavior.
- Changing fullscreen paywall precedence, viewport-gate policy, copy checks,
  orphan recovery, or legacy recovery rules.
- Refactoring attachment/snapshot generation or its 1.5-second scheduling.
- Changing renderer output, adding a recovery panel, or redesigning viewer UI.
- Migrating the AsyncAPI Studio viewer. The OpenAPI macro shipped in the
  AsyncAPI variant still uses the shared OpenAPI path and remains covered.
- Adding a new Mixpanel event name.

## Approaches considered

### 1. Patch the two observed bugs

Move `markContentSource('swr_cache')` before the Graph mount and publish a
failure flag from each `onError`. This is the smallest diff, but it leaves two
SWR Implementations, duplicated target resolution, indirect state, and
renderer-owned once-only behavior intact.

### 2. Deepen the viewer load Module — selected

Replace both lifecycle Implementations with one Module that owns context,
target identity, SWR, state transitions, render revisions, and terminal
reporting. Entry points retain only domain-specific loading/recovery Adapters,
and renderers report through a narrow Interface.

This creates Leverage: fixes to ordering, cache isolation, failure completion,
or telemetry happen in one Locality and apply to all plain viewers.

### 3. Include post-render side effects

Also move attachment and snapshot work behind a standard post-render scheduler.
That would make the lifecycle broader, but combines read-path correctness with
write-side behavior and materially increases validation risk. It is deferred to
a separate change.

## Architecture

### Module and Seam

Create `utils/viewerLoadLifecycle.ts` as the owning Module. Once all callers are
migrated, remove `utils/viewerBootstrap.ts`; a permanent compatibility wrapper
would preserve the shallow split this refactor is intended to remove.

The Module owns:

- the resolved Forge context value for the session, after preserving any
  required `apWrapper` initialization;
- target resolution and cache identity construction;
- paywall-before-mount ordering for callers that use the fullscreen gate;
- cache read, decode, publication, revalidation, and write;
- content fetch timing;
- explicit load-state transitions;
- render revisions and immutable content-source attribution;
- terminal `macro_viewed` deduplication.

The Seam is expressed by two narrow Interfaces.

```ts
interface ViewerContentAdapter<TTarget> {
  resolve(context: ViewerForgeContext): Promise<ViewerTargetResolution<TTarget>>;
  load(target: TTarget): Promise<Diagram | undefined>;
}

interface ViewerRenderReporter {
  rendered(revision: number, detail?: RendererCompletionDetail): void;
  failed(revision: number, reason: ViewerRenderFailureReason): void;
}
```

`ViewerTargetResolution` is a tagged union. Its loadable branch carries the
single target value used by `load` and an optional complete cache identity; its
non-loadable branch carries a bounded empty/failure reason. This lets an
invalid or cross-site Embed target stop without manufacturing an ID or calling
`load`. Graph, OpenAPI, Embed, and the sequence family implement the content
Adapter; none receives a separate `resolveContentId` callback.

`ViewerRenderReporter` is provided to the mounted Vue tree by `mountRoot`.
Renderer components use it in viewer mode. When the same components run in an
editor without a viewer session, their existing editor reporting behavior is
preserved through a small fallback Adapter.

### Content identity

```ts
interface ViewerContentIdentity {
  cloudId: string;
  customContentId: string;
  macroKind: 'sequence' | 'mermaid' | 'plantuml' | 'graph' | 'openapi' | 'embed';
}
```

The cache key is a versioned encoding of all three fields. If `cloudId` or
`customContentId` is unavailable, the load proceeds normally with SWR disabled;
the Module never falls back to an unscoped key.

The cache namespace moves to v2. Existing id-only entries are ignored and age
out rather than being interpreted under the new contract. The cache remains a
best-effort optimization; Confluence custom content is always revalidated and
remains the system of record.

Embed resolves configured IDs and AutoConvert targets once. Same-site checking
and existing AutoConvert analytics occur in that Adapter resolution. A
cross-site or invalid target cannot produce a cache identity or a fetch target.
Legacy UUID recovery can still load without a cache identity.

### Explicit state

Replace the `NULL_DIAGRAM + diagramLoadComplete` state protocol with a tagged
state owned by the session:

```ts
type ViewerLoadState =
  | { status: 'loading' }
  | { status: 'rendering'; revision: number; source: ContentSource }
  | { status: 'rendered'; revision: number; source: ContentSource }
  | { status: 'empty'; reason: ViewerEmptyReason }
  | { status: 'failed'; reason: ViewerFailureReason };
```

Reasons are bounded codes, not raw exception strings. Raw errors may be handed
to the existing local `onError`/console diagnostic callback but are not stored
in analytics or shared UI state.

`NULL_DIAGRAM` remains only as a compatibility document for components that
require a Diagram-shaped value during initial mount. It no longer determines
whether loading has completed or failed. After all consumers move to the tagged
state, `diagramLoadComplete` is removed.

### Render revisions

Every published document receives a monotonically increasing revision and an
immutable source (`fetch` or `swr_cache`). The Vue provider exposes the session
and current revision to the renderer. A completion callback for an obsolete
revision cannot relabel a newer render.

The first valid terminal report wins:

- `rendered(revision)` completes a successful session;
- an empty content result completes it as `empty`;
- an unrecovered context, fetch, decode, or render error completes it as
  `failed`;
- later SWR publications may update what is displayed but cannot emit a second
  `macro_viewed`.

A cached revision's render failure is not terminal while its source-of-truth
revalidation can still recover with changed content. It becomes terminal only
when no current or pending revision can succeed. This prevents an old cached
callback from defeating a newer fetch revision.

Renderer milestones use the strongest completion signal already available:

- Sequence and Mermaid: renderer promise resolved;
- PlantUML: SVG response assigned;
- Graph: `GraphViewer` constructed successfully;
- OpenAPI: the loaded spec has been handed to Swagger UI after content settles;
  this preserves the strongest currently evidenced milestone and must not
  regress to reporting from the empty shell mount. If implementation discovers
  a library completion callback, it is adopted only with a focused test; the
  design does not claim full-paint timing without that evidence;
- Embed: the outer session owns `macro_type = embed`; its delegated renderer
  reports completion through the same provided session.

### Analytics contract

No new event name is introduced. The existing `macro_viewed` contract gains two
typed properties in the first implementation commit:

| Property | Value | Purpose |
|---|---|---|
| `viewer_lifecycle_version` | `2` | Separates the new duration definition from historical events. |
| `viewer_load_outcome` | `rendered`, `empty`, or `failed` | Keeps readership attempts observable while allowing performance queries to select successful renders. |

`macro_viewed` fires at most once per plain-viewer session. To preserve the
existing readership interpretation documented by OpenAPI, empty and failed
terminal attempts remain countable; they are no longer mixed anonymously into
successful render percentiles.

For `viewer_load_outcome = rendered`, `duration_ms` ends at the renderer
milestone above. For `empty` or `failed`, it ends when the terminal state is
classified. Performance comparisons must filter to lifecycle v2, rendered
outcome, macro type, content source, browser cache state, and visible-tab loads.

`content_source` is passed from the immutable render revision into terminal
tracking. It is not inferred from mutable last-wins state. Renderer-specific
`render_mode` and `cache_source` values continue to be supplied as completion
detail.

## Runtime flow

### Cache miss

1. Initialize Forge context once.
2. Run paywall/gate checks without allowing cache publication or a viewer mount
   to precede a blocking fullscreen paywall. Existing content-request ordering
   is preserved where it differs between entry points.
3. Resolve one target and optional complete cache identity.
4. Mount the compatible loading shell and enter `loading`.
5. Time and execute `adapter.load(target)`.
6. On a document, write its raw serialization to the v2 cache, publish a
   `fetch` revision, and enter `rendering`.
7. The renderer reports the revision; the session enters `rendered` and emits
   one terminal event.
8. On `undefined`, enter `empty`; on a throw, enter `failed`. Both paths stop
   loading and make one terminal reporting attempt.

### Cache hit

1. Parse the cached raw document.
2. Start revalidation immediately, before any viewport gate can delay rendering.
3. Publish a `swr_cache` revision before invoking any synchronous renderer.
4. Render from cache and complete the session when that revision reports.
5. Cache parse failure evicts/ignores the entry and falls through to the normal
   fetch path.
6. A successful revalidation refreshes the cache. If the hash changed, publish
   a new `fetch` revision; if unchanged, do not re-render.
7. Empty or failed revalidation leaves a successfully rendered cached document
   standing and does not change the terminal outcome.

The existing `afterLoad` work remains an Adapter callback named to reflect its
actual contract, such as `afterFreshLoad`. It runs only after a real fetch, as
today, and is not awaited by the first cached render.

## Error handling

- Context or target-resolution exceptions become `failed`; they cannot return
  with the store still in `loading`.
- Missing or inaccessible content that resolves without a document becomes
  `empty`, preserving the distinction from an exception.
- Cache corruption is recoverable and falls through to the source-of-truth
  fetch.
- Renderer exceptions must call `failed` instead of being swallowed into a
  blank canvas. This branch models the state but does not add the recovery UI
  from Draft PR #196.
- Once cached content has rendered successfully, revalidation failure is a
  warning only; it cannot replace visible content with an error.
- Analytics and cache writes are best effort and cannot reject the load.

## Compatibility constraints

- Fullscreen paywall is evaluated before a cache-backed viewer can mount. This
  refactor does not make network-request order part of the Interface: the
  Diagram macro may preserve its existing request-before-gate order while the
  dedicated viewers preserve their gate-before-request order.
- Sequence viewport deferral still starts revalidation immediately rather than
  waiting for the viewport gate.
- Raw compressed Graph documents remain cached raw and are normalized only at
  publication, matching live-fetch behavior.
- Orphan observation, legacy content-property recovery, AutoConvert lifecycle
  events, and copy gating retain their current triggers.
- Attachment and snapshot callbacks retain their existing fresh-fetch timing.
- Editor and preview mounts continue working without a viewer session.

## Test strategy

Implementation follows red-green-refactor against public Interfaces, one
vertical slice at a time.

### Lifecycle contract tests

- Forge context and target resolution each occur once.
- Complete cache identities separate cloud IDs and macro kinds; incomplete
  identities disable cache access.
- A synchronous cache-hit renderer receives `swr_cache` before completion.
- Cache hit starts revalidation immediately and emits one terminal event.
- Unchanged revalidation does not republish; changed content publishes a new
  revision without a second event.
- Corrupt cache falls through to fetch.
- `undefined` becomes `empty`; a thrown load becomes `failed`; neither remains
  loading.
- A stale or duplicate render callback cannot overwrite the terminal outcome
  or emit twice.
- Cached success followed by revalidation failure remains rendered.

### Adapter and renderer tests

- Sequence-family, Graph, OpenAPI, and Embed target-resolution tests prove that
  the target used for cache identity is the one used for loading.
- Embed covers configured ID, valid same-site AutoConvert, invalid link,
  cross-site rejection, and legacy UUID fallback.
- Each renderer reports success only at its documented milestone and reports a
  bounded failure on its error path.
- Embed records `macro_type = embed` regardless of the delegated diagram type.
- Existing paywall, viewport-gate, orphan, legacy-recovery, and attachment tests
  remain green.

### Validation

- Run focused Vitest suites after each slice, then the repository unit suite,
  type checking, and lint for changed files.
- Build Lite, Full, Diagramly, and AsyncAPI variants because shared OpenAPI and
  renderer code crosses product builds.
- On staging, collect UI evidence for one Sequence-family viewer, Graph,
  OpenAPI, and Embed on both fetch and cache-hit paths where practical.
- Force one safe load failure and verify that loading terminates. Do not claim a
  recovery-panel UI assertion because that UI is outside this branch.

## Delivery and acceptance

The implementation lands in small commits: analytics types, lifecycle contract,
one migrated vertical slice, remaining Adapters, renderer completion, then old
path deletion. Intermediate commits may temporarily contain both paths, but the
final branch must not.

Acceptance requires:

- one production lifecycle Module for all in-scope plain viewers;
- no `resolveContentId` callback or duplicated SWR block in `forgeIndex.ts`;
- no consumer using `diagramLoadComplete` as a terminal-state signal;
- exactly-once v2 terminal reporting in contract tests;
- the Graph cache-hit source ordering regression covered by a test;
- all required validation green;
- a final production-code diff review showing that the duplicated
  Implementation was deleted. Tests and documentation may increase total
  repository lines.

If Draft PR #196 lands before this branch, rebase and adapt its state names at
the Module boundary. Do not reintroduce two state owners, and keep its recovery
panel outside this refactor's implementation commits.
