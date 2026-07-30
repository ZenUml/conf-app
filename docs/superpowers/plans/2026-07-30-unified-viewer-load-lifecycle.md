# Unified Viewer Load Lifecycle — Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-30-unified-viewer-load-lifecycle-design.md`

## Delivery rules

- Work only on `refactor/unify-viewer-load-lifecycle` / PR #423.
- Preserve editor, attachment, snapshot, recovery-panel, renderer-output, and
  AsyncAPI Studio behavior.
- Use one behavior-level test followed by the minimum Implementation for that
  behavior; keep every vertical slice green before starting the next.
- Keep legacy editor/preview `trackRenderTime` behavior through a fallback
  Adapter while the viewer lifecycle becomes the sole v2 event owner.
- Preserve observable paywall precedence: no viewer mount or cache publication
  before a blocking fullscreen paywall. Do not standardize request timing.

## Slices

1. **Analytics contract** — add the bounded lifecycle version/outcome vocabulary
   to `catalog.ts` and `types.ts`, with tracker passthrough coverage. Commit:
   `11186ca0`.
2. **Tenant-aware content cache** — change the cache Interface to require the
   complete `{cloudId, customContentId, macroKind}` identity; use a v2 namespace,
   preserve LRU/quota behavior, and prove tenant/macro separation plus incomplete
   identity fail-closed behavior.
3. **Terminal analytics Adapter** — factor `trackRenderTime` payload assembly so
   lifecycle v2 can emit `rendered | empty | failed` while immutable revision
   `content_source` overrides legacy mutable timing state. Preserve idle renderer
   prefetch and the current editor/preview Interface.
4. **Vue reporter Seam** — add a dependency-neutral injection key and reporter
   Interface. Extend `mountRoot` and fullscreen paywall mounting with an optional
   reporter, proving that a wrapped renderer receives the same session.
5. **Deep lifecycle Module** — build `viewerLoadLifecycle.ts` through its public
   Interface. Cover context/target resolution once, cache hit before synchronous
   completion, immediate revalidation, revision ordering, exactly-once terminal
   reporting, corruption fallback, empty/failed terminals, and cached-success
   resilience.
6. **OpenAPI walking slice** — resolve config/modal target once, migrate its entry
   point, and report completion only after the loaded spec is handed to Swagger
   UI. Remove its `diagramLoadComplete` dependency.
7. **Graph slice** — preserve DrawIO preload and compressed-Graph normalization;
   prove the original cache-hit source race is fixed and renderer failure reaches
   the reporter.
8. **Embed slice** — make configured/AutoConvert/legacy target resolution single
   source, preserve AutoConvert analytics and same-site rejection, use explicit
   load state for existing spinner/error UI, and keep the outer `macro_type=embed`.
9. **Diagram macro slice** — move only plain Sequence/Mermaid/PlantUML viewers
   behind the Module. Preserve cross-page copy checks, viewport gate timing,
   orphan/legacy/snapshot recovery, fullscreen paywall behavior, and editor code.
10. **Deletion and validation** — remove `viewerBootstrap.ts`, the duplicate SWR
    block, renderer-owned viewer tracking, and `diagramLoadComplete`; run focused
    suites after every slice, then unit/lint/build validation for lite, full,
    diagramly, and asyncapi. Review the final production-code diff for actual
    deletion and one lifecycle Implementation.

## Acceptance evidence

- Contract tests show one v2 `macro_viewed` per session for rendered, empty, and
  failed outcomes.
- A synchronous Graph cache-hit reports `content_source=swr_cache`.
- Changed revalidation republishes a new revision without a second event; stale
  callbacks cannot win.
- Cache keys differ across cloud IDs and macro kinds; incomplete identities do
  not touch storage.
- Existing Embed terminal copy and paywall behavior remain covered.
- Grep finds no `resolveContentId`, `diagramLoadComplete`, or production import of
  `viewerBootstrap` after migration.
