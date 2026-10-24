# Content-Opening Unification — Design

- **Date:** 2026-07-31
- **Status:** Approved in dialogue; awaiting written-spec review
- **Supersedes:** the broad lifecycle attempt of PR #423 (closed). Coexists with
  `2026-07-31-behavior-preserving-viewer-load-refactor-design.md` (the narrow
  PR #425 SWR extraction): that document's non-goals govern *that* refactor
  only. Where a slice of this design lands, it supersedes those non-goals
  within its own scope.

## Objective

Unify how conf-app opens diagram documents — context/route classification,
paywall decision, target resolution, custom-content/legacy recovery,
normalization, cache policy, and load-result publication — into **one concrete
document-opening pipeline** used by every viewer, fullscreen, dashboard, and
editor surface (AsyncAPI Studio excluded), deleting the per-family duplicated
orchestration as each surface migrates.

## Design principles

These govern every slice and must be carried verbatim into any subagent task
prompt for this work:

- Consistency and structural simplicity are the primary goals.
- When current viewers behave differently, choose one reasonable rule instead
  of preserving every historical variation with hooks and adapters.
- Small user-visible changes are acceptable if they result naturally from that
  simplification.
- Do not add states, fallbacks, telemetry, recovery UI, or other code merely to
  make behavior "better".
- Preserve only hard requirements: data integrity, authorization/paywall
  enforcement, and essential legacy-content compatibility.
- Success means fewer concepts, fewer branches, and preferably less production
  code — not perfect behavioral equivalence.

## Background and evidence

- Seven-plus independent content-opening implementations exist today:
  `forge-swagger-ui.ts` / `forge-swagger-editor.ts` (~85 duplicated LOC),
  `forge-graph-viewer.ts` / `forge-graph-editor.ts` (~215 duplicated LOC incl.
  decompression), `forge-embed-viewer.ts` (two copies: async `loadDiagram` +
  sync `resolveEmbedContentId`) / `forge-embed-editor.ts`, and the
  Sequence-family block in `forgeIndex.ts` (~500 LOC). All verified with
  file:line evidence against `main` (multi-agent verification, 2026-07-31).
- A shared viewer pipeline **already exists**: `bootstrapForgeViewer`
  (`src/utils/viewerBootstrap.ts`), with exactly three callers
  (graph/openapi/embed viewers) doing paywall → SWR → fetch since PR #417.
  This design evolves it into the pipeline's successor rather than founding a
  new abstraction — the mistake that sank PR #423 (net +852 production LOC of
  lifecycle/adapter infrastructure).
- The two existing pipelines have **inverse paywall ordering**:
  `viewerBootstrap` gates before fetching (placeholder doc); `forgeIndex.ts`
  fetches first and gates with the loaded doc. This design picks one order
  app-wide (see Data flows).
- Sequence's load and save are coupled through module-scope mutable state
  (`originalCustomContentId`, `recoveryPageId`, `legacyLoadBlocked`,
  `doc.isCopy` → `publishBlock`) consumed by the save handler with no
  compile-time link. This design replaces that with a typed hand-off
  (`DocumentOrigin`).
- **Live defect found during verification:** `forge-graph-editor.ts:143`
  re-implements the shared `decideWriteback()` (`src/model/writebackGate.ts`)
  without the `repairWillPersist &&` gate — in the non-submittable in-viewer
  Edit modal with a changed content ID it still calls `view.submit()`, exactly
  the case the helper exists to prevent. `forge-swagger-editor.ts:169` has a
  different drift (missing legacy-migration term). Fixed by Slice 0.
- PR #423's rejected diff also demonstrated the one regression class any
  extraction here must guard: dropping `isDisplayMode` threading into load
  analytics, mis-tagging native-dialog renders as `surface: 'viewer'`
  (issues #368/#369).

## Decomposition (approved)

Every slice migrates a real production path **and deletes that path's old
orchestration in the same PR**. No framework-only PRs. Order:

0. **Writeback-decision unification.** Adopt `decideWriteback()` in the Graph
   and Swagger editors; failing test first for Graph's missing
   `repairWillPersist` gate. Independently valuable; fixes the live bug.
1. **OpenAPI.** Evolve `bootstrapForgeViewer` into the document-opening
   pipeline; absorb the swagger viewer/editor duplicated resolution
   (config/modal + orphan + UUID recovery). The resolution result exposes which
   source matched (the editor derives `isDashboardEdit` from it). Threads
   `isDisplayMode`. Coordinate with the in-flight `feat/error-panel` change to
   `forge-swagger-ui.ts`'s `loadDiagram` signature.
2. **Graph.** Migrate viewer + editor acquisition together. `copyCheckMode`
   becomes policy-derived (read = cross-page-only scan, write = full blocking
   scan). Pipeline output carries the orphan/legacy fields Graph's save-repair
   consumes. Delete both old recovery chains (~215 LOC of orchestration; the
   shared `ApWrapper2` primitives stay).
3. **Embed.** Collapse the three resolution copies (viewer-async, viewer-sync,
   editor-async) into the shared module, which exposes a sync id-resolver (SWR
   cache key) and an async doc-acquirer. Adds the unit tests these files
   currently lack. AutoConvert and same-tenant guard stay viewer-only inputs
   expressed in Embed's target spec.
4. **Sequence-family read + write, merged.** One slice migrating viewer,
   fullscreen, and editor together with the explicit `DocumentOrigin` hand-off;
   applies the app-wide paywall ordering; viewport gating stays a presenter
   capability; deletes the old `forgeIndex.ts` loading block and retires
   `viewerBootstrap.ts` by making the pipeline its successor.

Excluded: AsyncAPI Studio (`forge-asyncapi-*.ts`) — its build-gated
React/Studio architecture is a genuinely separate system; excluding it adds no
branch to the pipeline. OpenAPI in the asyncapi product variant **is** covered
(verified: no `PRODUCT_TYPE` conditional in the swagger entry files; one shared
macro module across variants).

## Architecture

Three component kinds. Dependency direction: entry files → pipeline →
`ApWrapper2`/paywall/cache utils. The pipeline never imports a presenter or
Vue/React.

### 1. The pipeline (common, one concrete function)

`openDocument(context, policy, target) → OpenOutcome`, in
`src/utils/documentOpening/` (evolved from `viewerBootstrap.ts`). Owns, in one
place: paywall decision, cache policy, recovery orchestration, normalization,
and load-result analytics publication with `isDisplayMode` threaded.

`policy` is a two-value capability — `'read'` (SWR allowed, cross-page-only
copy scan) and `'write'` (fresh load, full blocking copy scan, recovery fields
captured for save). **Every behavioral difference must be expressible as
read-vs-write or live in the target spec; per-diagram flags inside the
pipeline are a design failure.**

### 2. Per-family target specs

```ts
interface TargetSpec {
  resolveId(ctx): { contentId?: string; source: TargetSource } | undefined
  // sync — doubles as the SWR cache key
  legacyFallbacks: LegacyFallback[]   // ordered, family-specific
  onMiss?: 'default-doc' | 'fail'     // embed editor mounts a picker; viewers fail
}
```

`source` lets the Swagger editor keep deriving `isDashboardEdit`
(modal-matched but not config-matched) without a pipeline branch, and subsumes
Embed's sync `resolveEmbedContentId` by construction.

### 3. The `DocumentOrigin` hand-off (load → save contract)

```ts
interface OpenedDocument {
  doc: Diagram
  origin: {
    contentId?: string; source: TargetSource
    recoveredFromOrphan: boolean; legacyLoadBlocked: boolean
    isCopy?: boolean; copyReason?: string
    originalCustomContentId?: string; recoveryPageId?: string
  }
}
```

Editors pass `origin` explicitly into their save path, where
`decideWriteback()` and the fail-closed `legacyLoadBlocked` check consume it.
This replaces `forgeIndex.ts`'s module-scope mutable state.

### Outside the pipeline

Mounting/presentation (five UI stacks: Workspace.vue, DrawIO wrapper, Swagger
React shell, Embed picker, AsyncAPI Studio); save execution
(`saveToPlatform` + `decideWriteback`, editor-owned); the viewport render gate
(Sequence presenter capability, wrapped around mount); Embed's render-time
re-entry into other families' viewer components (presentation, untouched).

## Data flows

### Paywall ordering — one rule app-wide: paywall → cache → fetch

Chosen over Sequence's current fetch-first order. Rationale: a blocked user
costs no content fetch; three families already run this order; only Sequence
migrates. **User-visible change (accepted):** paywalled Sequence macros show
the wall earlier and never load content.

Constraint: `macroKind` must derive from entry context
(`moduleKey` / `modal.diagramType`) instead of the loaded `doc.diagramType`.
Family-level derivation is verified feasible (`macroEntryRouting.ts`).
**Slice-4 verification item:** whether per-type (Sequence vs Mermaid vs
PlantUML) derivation is fully possible pre-fetch; fallback — the paywall needs
only family granularity, per-type info may be attached post-fetch for
analytics-only uses.

### Read flow (viewer, fullscreen, dashboard-view)

```
resolveId (sync) → paywall → SWR: cache-hit mount + background revalidate
                           → miss: live fetch → legacy fallbacks → normalize
                             → publish analytics → mount
```

Consistency change (accepted): **fullscreen joins the read policy and gets
SWR** (today Sequence's SWR explicitly excludes fullscreen — that exception
branch is deleted). Plain viewers have no paywall today and keep none: the
paywall module decides applicability per surface; the pipeline has no surface
branch.

### Write flow (all editors)

```
resolveId (sync) → paywall (editor gate) → fresh fetch (no cache read)
  → full copy scan (guards the save-fork path)
  → legacy fallbacks (fail-closed: failure sets legacyLoadBlocked)
  → normalize → OpenedDocument{doc, origin} → editor
```

After a successful save the editor **writes through the cache**
(`putCachedContent`) so the next read cannot SWR stale content — a consistency
guarantee the current code does not make.

### Errors and defaults

Declared in `TargetSpec`, not scattered: on total resolution failure, viewers
show a terminal error (no family-specific silent degradation); the Embed
editor declares `onMiss: 'default-doc'` (picker); Sequence new-macro uses the
same default-doc mechanism for its example diagram. The `plantUmlCode`
backfill collapses from three copies in `forgeIndex.ts` to one normalize step.

## Recovery, normalization, side effects, save safety

### Recovery

The `ApWrapper2` primitives (`loadCustomContentWithOrphanRecovery`,
`findLegacyCustomContentByUuid`, `getContentPropertyV2`) and telemetry
reporters stay where they are — they were never duplicated. The duplicated
**orchestration** moves into the pipeline, driven by each family's ordered
`legacyFallbacks`:

- **OpenAPI:** orphan recovery → uuid-title recovery
- **Graph:** orphan → content-property (`zenuml-graph-macro-${uuid}-body`) →
  uuid-title (decompression is normalization, not recovery)
- **Embed:** direct-ID → legacy uuid
- **Sequence:** legacy content-property → cross-page uuid →
  snapshot-attachment

Telemetry asymmetry unified: any surface's direct-ID miss emits
`reportOrphanObserved` with a `surface` property (today: embed viewer only).
The property extension is registered in the analytics catalog as the first
commit of Slice 3.

### `legacyLoadBlocked` fail-closed generalization

Under the write policy, **any family's** legacy-fallback failure (forbidden /
page_not_found / error / unexpected value shape) sets
`origin.legacyLoadBlocked`. The save side already exists:
`Persistence.ts` throws `LegacyLoadBlockedSaveError`; editors uniformly
catch → toast → refuse to save. This extends Graph's data-loss protection to
the Swagger and Embed editors as a consequence of consistency — a hard
requirement (data integrity), not behavior polish.

### Normalization (one step)

`plantUmlCode` backfill, `compressed` decompression, doc shape defaults. The
pipeline always outputs a well-formed `Diagram`.

### Post-load side effects

- **Pipeline owns:** load-result analytics (with `isDisplayMode` + `surface`),
  orphan telemetry, staleness hint, snapshot-attachment backfill trigger (all
  verified to fire at the same post-fetch/pre-mount point and self-gate
  internally), and the single first-wins `renderPerf.time('fetch')` mark.
- **Presenter owns:** viewport render gate (Sequence), Sequence-specific
  `markContentSource` / `markAppEntry` marks. **Slice-4 verification item:**
  confirm the pipeline's fetch mark does not collide with Sequence's existing
  marks.

### Save safety — three layers

1. **Decision** — shared: `decideWriteback()` consuming `origin` (Slice 0
   unifies Graph/Swagger onto it).
2. **Refusal** — shared: `LegacyLoadBlockedSaveError` + the uniform
   catch/toast pattern.
3. **Execution** — editor-owned: `saveToPlatform`, Embed's reference-only
   `view.submit`, AsyncAPI Studio's postMessage. Never in the pipeline.

## Error handling, tests, delivery gates, acceptance

### Error handling

`OpenOutcome = paywalled | opened(OpenedDocument) | failed(OpenError)`.
Failures surface; silent degradation is forbidden (repo hard rule). Slice 1
adopts the `feat/error-panel` viewer error contract
(`ViewerLoadDiagramResult.loadError`) rather than creating a parallel one.

### Tests

- Slice 0: failing test first for the Graph writeback defect (non-submittable
  Edit modal + `idChanged` must not `view.submit`).
- Pipeline unit tests per policy (paywall ordering, SWR read-only, policy-derived
  copy scan, `legacyLoadBlocked` capture) and per family (source matching /
  `isDashboardEdit`, Embed same-tenant rejection).
- Slice 3 adds the unit tests the embed entry files currently lack — no bare
  migration.
- New/changed Mixpanel events land in `catalog.ts` as each slice's first
  commit.
- Existing Playwright E2E stays green per slice; each slice gets a staging
  spot check that **must assert `surface`/`isDisplayMode` tagging** on
  `macro_viewed` (the #423 regression gate).

### Delivery gates (per slice)

1. Same PR: migrate the real production path + delete its old orchestration.
2. Branch from current `main` only (the long-lived feature workspaces are
   stale on these files); Slice 1 reconciles with `feat/error-panel` first.
3. CI green (the `pull_request` run), typecheck no worse than the `main`
   baseline.
4. The next slice starts only after the previous slice's staging verification.

### Final acceptance — the countable ledger

Net production LOC may be modestly positive (user decision), but the following
must all hold:

| Count | Today | End state |
|---|---|---|
| Content-opening implementations | 7+ (swagger×2, graph×2, embed×3, forgeIndex block) | 1 pipeline + 4 target specs |
| Paywall/fetch orderings | 2 (inverse) | 1 |
| Copy-scan modes | ad hoc per site | policy-derived |
| `plantUmlCode` backfills | 3 | 1 |
| Writeback decisions | 3 (two defective) | 1 |
| Fail-closed save protection | 2 families | all write surfaces |
| Whole-file deletions | — | `viewerBootstrap.ts` (183 LOC, after its 3 callers migrate) |

Structural criterion: **zero family branches inside the pipeline.** Any
difference not expressible as read/write policy, a `TargetSpec`, or a
presenter concern means the design failed — fix the design, don't add an `if`.
