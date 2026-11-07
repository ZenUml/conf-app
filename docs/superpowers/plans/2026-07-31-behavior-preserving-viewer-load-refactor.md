# Behavior-Preserving Viewer Load Refactor Plan

**Design:** `docs/superpowers/specs/2026-07-31-behavior-preserving-viewer-load-refactor-design.md`

## Baseline

1. Run `src/utils/viewerBootstrap.spec.ts`,
   `src/utils/renderCache/contentCacheStore.spec.ts`, and
   `tests/unit/viewerBootstrap-compressed-graph.spec.ts` before editing.
2. Record that the branch contains no production diff from `origin/main`.

## TDD slice 1: changed content

1. Add `src/utils/renderCache/revalidateViewerContent.spec.ts` with one test:
   a changed fresh document is stored, then passed to `onChanged`, then to
   `afterFresh`.
2. Run that test and observe RED because the public helper module is absent.
3. Add the smallest `revalidateViewerContent` implementation that makes the
   test GREEN.

## TDD slice 2: unchanged content

1. Add one test proving unchanged content is stored and reaches `afterFresh`
   without invoking `onChanged`.
2. Observe RED, make the minimal implementation change, and rerun GREEN.

## TDD slice 3: empty and rejected loads

1. Add one test proving an empty load performs no cache write or callbacks.
2. Observe RED and make it GREEN.
3. Add one test proving a rejected load resolves, warns with the existing
   message, and invokes no callbacks.
4. Observe RED and make it GREEN.

## Integrate dedicated viewers

1. In `src/utils/viewerBootstrap.ts`, replace only `revalidateViewer`'s common
   algorithm with `revalidateViewerContent`.
2. Keep its call after cached mount/publication/content-source marking.
3. Keep `renderPerf.time('fetch', ...)`, `publishLoadedDiagram`, and awaited
   `afterLoad` in caller callbacks.
4. Delete the superseded local `revalidateViewer` function.
5. Run `src/utils/viewerBootstrap.spec.ts` and the helper spec.

## Integrate Sequence-family viewers

1. In `src/forgeIndex.ts`, keep the existing cache-hit order and
   `revalidateSequenceViewer` wrapper.
2. Leave orphan reporting and snapshot scheduling inside its `loadFresh`
   callback.
3. Delegate only serialize/store/hash/changed/error handling to the helper.
4. Leave fetch timing absent on this background path, as on `main`.
5. Keep PlantUML defaulting, content-source marking, and viewport-gated remount
   in `onChanged`.
6. Run the helper, bootstrap, cache, compressed-Graph, render-gate, and relevant
   component suites.

## Diff audit and validation

1. Confirm there are no changes under analytics, store, components,
   `mount-root`, paywall, or content-cache storage.
2. Confirm production additions minus deletions are at most zero against
   `origin/main`.
3. Run the complete unit suite.
4. Build Lite, Full, Diagramly, and AsyncAPI.
5. Run `git diff --check` and changed-file lint/type validation available in the
   repository.
6. Do not push or create a replacement PR without explicit authorization.

