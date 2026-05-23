---
title: Orphan custom-content recovery — generalized design
date: 2026-05-23
related_branches:
  - fix/zen-1170-defect-2b-recovery (existing, to be replaced)
related_prs:
  - "#119 (merged): telemetry probe — reportOrphanObserved, probeOrphanRecovery"
status: proposed
---

# Orphan custom-content recovery — generalized design

## 1. Context

Defect 2b (ZEN-1170): some macros reference a `customContentId` that no
longer resolves (the CC was deleted or migrated), but a surviving sibling
on the same page still carries `body.id === <orphan id>`. The viewer
crashes with an empty render; users see a broken diagram with no signal
that recovery is possible.

PR #119 (merged to main) added telemetry-only observation: every orphan
render fires `customcontent_orphan_observed` to Mixpanel with the probe
result (candidate count, page children total, etc.). No behavior change
on the user-visible side.

PR #120 (branch `fix/zen-1170-defect-2b-recovery`, not merged) added two
things on top:
1. **Read recovery**: when the orphan probe returns exactly one matching
   sibling, the viewer (and editor) render that sibling instead of an
   empty diagram.
2. **Macro XML repair**: when the editor was loaded against a recovered
   sibling, its save handler calls `view.submit({config: …})` to repoint
   the macro's `parameters.guestParams.customContentId` to the recovered
   id. After one such save, the orphan is gone from the page.

The branch ships both as one PR. This spec splits them into two
sequential releases for safety, fixes a known telemetry bug in PR #120,
adds the missing UI gating so the repair path is always reachable, and
captures the design notes in `private/forge-macro-config/index.html` so
the team's internal docs match reality.

## 2. Scope

**In scope:**
- Reading and rendering a recovered orphan sibling when probe returns
  exactly one match (current PR #120 read recovery).
- Repairing the macro XML on save from a context that actually can.
- Disabling the in-page viewer "Edit" button when the diagram was
  recovered, so the user is routed through page-edit mode (the only
  context where repair fires).
- Honest telemetry: `customcontent_orphan_macro_repaired` only fires when
  the repair actually happened (i.e., the editor was in a
  macro-config-editor view, not a viewer-spawned modal).
- Adding an editor-context badge to the dev-only DebugBar and an
  "Editor-context discrimination" section to the internal docs site.

**Out of scope (declined during brainstorming):**
- A user-facing recovery prompt with a candidate picker. Probe is binary
  (`body.id` matches or it doesn't) so "confidence" is implicit;
  >1-candidate cases stay telemetry-only as today.
- Auto-recovering ambiguous (>1 candidate) cases via heuristic (most
  recent, largest, etc.).
- Recovering from prior CC versions, or from parse failures of valid CC
  bodies. Different failure modes, different sources, deferred.
- Mutating the macro XML from any path other than the macro-config
  editor (e.g., REST patch of the page body's ADF). Out of scope for
  cost/fragility reasons.
- **Embed macro recovery.** D1 inspection (2026-05-23) shows only 3
  `diagramType='embed'` rows across the entire production mirror, and
  every one has body `{"diagramType":"embed","source":"custom-content"}`
  with no `graphXml`/`code`/`mermaidCode`. The save path
  (`forge-embed-editor.ts:24`) passes a minimal stub to `saveToPlatform`,
  the resulting CC body has no `id` field for the recovery probe to
  match against, and `loadForgeViewerComponent('embed')` is documented
  to return `undefined`. Embed is effectively broken in production,
  independent of this design — recovery wouldn't help it. Embed is
  therefore excluded from the shared helper's call sites in Slice 1.
  A separate effort to repair or remove the embed feature is tracked
  outside this spec.

## 3. Architecture overview

Two slices, two PRs, sequenced from main.

```
┌────────────────────────────────────────────────────────────────┐
│ Slice 1 — Read recovery (PR A, no writes)                      │
│                                                                │
│  ApWrapper2.probeOrphanRecovery (main)        unchanged        │
│  ApWrapper2.probeOrphanRecovery + candidateIds   NEW           │
│  ApWrapper2.loadCustomContentWithOrphanRecovery  NEW           │
│  forgeGlobal.canRepairMacroXml                   NEW           │
│  forge-{embed,graph,swagger}-{viewer,editor}.ts                │
│    + forgeIndex.ts                              CALL loader    │
│  reportOrphanObserved payload: {recoveryUsed, recoveredId} NEW │
│  DebugBar editor-context badge + recovery marker  NEW          │
│  Dev-site §7/§8 docs update (correct + add new §8)  NEW        │
│                                                                │
│  Behavior change: orphans with exactly one matching sibling    │
│  now render the sibling instead of an empty diagram.           │
│  Pure read. No macro XML mutation. Reversible by flag.         │
└────────────────────────────────────────────────────────────────┘
                          │
                          │  observe in prod ~3–7 days
                          ▼
┌────────────────────────────────────────────────────────────────┐
│ Slice 2 — Repair + UI gating (PR B)                            │
│                                                                │
│  forge-{*}-editor.ts save handlers: macroNeedsRepair branch    │
│    gated on canRepairMacroXml                       NEW        │
│  reportOrphanMacroRepaired only fires when repair               │
│    actually happened                                NEW        │
│  Diagram.copyReason adds 'orphan-recovery' literal  NEW        │
│  Viewer loaders set isCopy/copyReason when recovered NEW        │
│  GenericViewer.editDisabledReason adds branch       NEW        │
│  Tests for editor-context predicate + Edit-button state        │
│                                                                │
│  Behavior change: viewer Edit disabled with tooltip for        │
│  recovered diagrams. Page-edit-mode save repairs macro XML.    │
│  Telemetry is now honest.                                      │
└────────────────────────────────────────────────────────────────┘
```

## 4. Design rationale: `modal.context` boundaries

A natural-sounding optimization for this design is: when the viewer
opens the editor via `openModal`, pass the *recovered* `customContentId`
through `modal.context` so the editor can skip its own probe. This
proposal is **rejected** in favor of keeping the macro XML as the
single source of truth. The reasoning matters because the same
pattern temptation will come up again.

### Three categories of `modal.context` payloads

| Payload kind | Example | Use? |
|---|---|---|
| Ephemeral session state not in macro XML | `journey_id`, `session_id`, `journey_start_time` | ✅ Yes — no other channel exists. Viewer derived; editor needs for analytics correlation. |
| Defensive workaround for Atlassian platform quirks | swagger viewer passing `customContentId` because `extension.config` is sometimes unreliable in the editor iframe | 🟡 Acceptable, but a hack — not a design pattern. Comment-required. |
| Derived state that both components could re-derive | recovered `customContentId` from viewer's orphan probe | ❌ Anti-pattern — couples consumers via side channel. |

Passing `recoveredId` falls squarely in category 3. The editor *can*
re-derive it by running its own probe on `extension.config.customContentId`
— slower, but correct, and independent.

### Why independent derivation is cleaner separation of concerns

- **Viewer** reads `extension.config.customContentId` → fetches (with recovery) → renders.
- **Editor (macro-config context)** reads `extension.config.customContentId` → fetches (with recovery) → loads for editing → on save, repairs macro XML.

Both have **one input** (the macro XML) and **one output** (rendered diagram / saved CC + repaired macro XML). They never observe each other's intermediate state. That means:

- Changing the viewer's recovery heuristic does not affect the editor's behavior.
- The editor sees the **current** state of the macro XML, not a snapshot the viewer took some time ago.
- No race conditions where viewer and editor see "different worlds" via stale modal payloads.

### What this design rejects (and why it's still correct)

Passing `recoveredId` via modal would have bought:
- One round-trip saved (editor skips its own probe).
- Guaranteed view/edit alignment by construction.

We give up:
- ~1 GET of latency in the modal-editor open flow. Negligible.
- "View/edit alignment by construction." Replaced by an architectural
  invariant: there is no modal-editor path for recovered diagrams in
  Slice 2 (viewer Edit is disabled), so the alignment problem
  dissolves — the user must transition to page-edit mode, at which
  point a fresh state derivation is correct.

### Implication for the dev-site

The new §8 in `private/forge-macro-config/index.html` (Editor-context
discrimination) should include a short paragraph titled "Why we don't
pass `recoveredId` via modal context", referencing the three-category
table above, so the principle is documented next to the discrimination
table.

## 5. Slice 1 — read recovery

### 5.1 New API surfaces

In `src/model/ApWrapper2.ts`:

```ts
async loadCustomContentWithOrphanRecovery(
  pageId: string | undefined,
  customContentId: string,
): Promise<{
  customContent: ICustomContentV2 | undefined;
  recoveredFromOrphanId?: string;
  probeResult?: Awaited<ReturnType<ApWrapper2['probeOrphanRecovery']>>;
}>
```

Behavior:
- `GET /custom-content/:id` first. If it resolves, return it as-is.
- Otherwise, if `pageId` is provided, call `probeOrphanRecovery(pageId, customContentId)`.
- If exactly one candidate child has `body.id === orphanId`, `GET` that
  candidate and return it with `recoveredFromOrphanId` set.
- All other branches (`pageId` missing, probe errors, 0 candidates, ≥2
  candidates, candidate fetch returns undefined) return
  `{ customContent: undefined, probeResult }`.

The `candidateIds` array is added to `probeOrphanRecovery`'s return so
the loader can select the unique candidate without re-iterating.

**Internal structure** — the method is split into two for readability and
recovery-branch isolation:

```ts
async loadCustomContentWithOrphanRecovery(pageId, customContentId) {
  // Step 1: try the direct id.
  const direct = await this.getCustomContentByIdV2(customContentId);
  if (direct) return { customContent: direct };

  // Step 2: direct failed → recovery.
  return this.attemptOrphanRecovery(pageId, customContentId);
}

private async attemptOrphanRecovery(pageId, orphanId) {
  if (!pageId) return { customContent: undefined };

  const probeResult = await this.probeOrphanRecovery(pageId, orphanId);
  if (probeResult.recoverable !== true
      || probeResult.candidateCount !== 1
      || !probeResult.candidateIds?.[0]) {
    return { customContent: undefined, probeResult };
  }

  const recovered = await this.getCustomContentByIdV2(probeResult.candidateIds[0]);
  if (!recovered) return { customContent: undefined, probeResult };

  return { customContent: recovered, recoveredFromOrphanId: orphanId, probeResult };
}
```

Top method reads as the algorithm ("try direct, else recover"); the
recovery method is self-contained and independently testable. Happy
path is still one fetch.

**Rejected alternative**: "resolve final id, then one unified fetch".
This would require knowing whether the direct id exists *without*
fetching it. The probe could in principle tell us by listing page
children, but (a) the probe is more expensive than a direct fetch, and
(b) cross-page CCs (`isCopy='cross-page'`) wouldn't appear in the
host-page children list. Probe-first would slow down every happy-path
render and would break cross-page diagrams. Not worth the duplicate-call
savings, which only happen in the orphan branch anyway.

In `src/model/globals/forgeGlobal.ts`:

```ts
export async function canRepairMacroXml(): Promise<boolean> {
  const context = await getContext();
  // True iff we're running in a macro-config-editor view. Modal-spawned
  // editor iframes have extension.modal set; view.submit({config:...})
  // from there closes the modal but cannot rewrite the host page's
  // macro XML.
  return !!context.extension?.macro?.isConfiguring && !context.extension?.modal;
}
```

`canRepairMacroXml` ships in Slice 1 even though no production code
calls it yet — it's used immediately by the DebugBar badge and by the
honest-telemetry fix below. Slice 2 wires it into the editor save handler.

### 5.2 Shared loader helper — avoid 8× call-site duplication

PR #120 adds near-identical recovery + telemetry blocks at 8 call sites
(4 viewers + 4 editors). Slice 1 must not inherit this duplication.

New helper at `src/utils/loadMacroDocumentWithRecovery.ts`:

```ts
export interface LoadedMacroDocument {
  doc: any | undefined;
  recoveredFromOrphanId?: string;
  originalCustomContentId?: string;
  recoveryPageId?: string;
}

export async function loadMacroDocumentWithRecovery(
  kind: MacroKind,
): Promise<LoadedMacroDocument> {
  const context = await getContext();
  const customContentId = context.extension?.config?.customContentId;
  const pageId = context.extension?.content?.id;

  if (!customContentId) {
    return { doc: undefined };
  }

  const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
    pageId, customContentId,
  );
  const doc = loaded.customContent?.value;

  if (loaded.recoveredFromOrphanId && doc) {
    reportOrphanObserved(pageId, customContentId, kind, loaded.probeResult, {
      recoveryUsed: true,
      recoveredId:
        loaded.customContent?.id != null
          ? String(loaded.customContent.id)
          : undefined,
    });
  } else if (!doc) {
    reportOrphanObserved(pageId, customContentId, kind, loaded.probeResult, {
      recoveryUsed: false,
    });
  }

  return {
    doc,
    recoveredFromOrphanId: loaded.recoveredFromOrphanId,
    originalCustomContentId: customContentId,
    recoveryPageId: pageId,
  };
}
```

The helper centralizes three concerns that are otherwise repeated 8 times:

1. Reading `customContentId` from `extension.config` and `pageId` from `extension.content.id`.
2. Calling `loadCustomContentWithOrphanRecovery` and unwrapping its result.
3. Emitting `reportOrphanObserved` with the correct payload variant.

Editor entries additionally need `originalCustomContentId` and `recoveryPageId` for Slice 2's repair detection — these are returned by the helper, so editor entries don't capture them separately.

**Note on the `extension.modal.customContentId` fallback (swagger and
sequence editors).** Two editors currently read
`extension.config.customContentId || extension.modal.customContentId`:
`forge-swagger-editor.ts:196` and `forgeIndex.ts:102`. The original
justification (dev-site §7) was that `extension.config` is sometimes
unreliable in viewer-spawned modal-editor iframes — without the
fallback, edits would be treated as new-macro sessions.

**Empirical verification (forge tunnel on lite-dev, 2026-05-23):** for
the OpenAPI macro tested, `extension.config.customContentId` was set
correctly in the modal-editor context (`isConfiguring: false`), and the
fallback never fired (`source: 'config'`). The original justification
is not borne out by the current Forge platform behavior.

**Caveat: no source-tracking telemetry exists.** None of the existing
Mixpanel events distinguish "resolved from config" vs "resolved from
modal fallback". We can't go back and verify whether the fallback was
ever load-bearing in production. The empirical test covers one case
(one macro, one site, one day) — not enough to remove the fallback
without risk.

**Plan (this spec):**
1. Slice 1 ships the shared helper without the fallback. The two
   editors (swagger, sequence) keep their existing fallback line for
   safety.
2. Slice 1 also adds **modal-fallback observability** (§5.7 below) —
   a Mixpanel event that fires only when the fallback would be
   load-bearing. Zero hits over the observation window = safe to remove.
3. A **separate release** (post-Slice-2, post-observation) removes
   the fallback from both files. Tracked as future work in §9.

### 5.3 Plumbing — 8 single-line call sites

The viewer + editor entries (embed excluded — see §2):

| File | Surface | Call |
|---|---|---|
| `src/forge-graph-viewer.ts` | Graph viewer | `await loadMacroDocumentWithRecovery('graph')` |
| `src/forge-swagger-ui.ts` | OpenAPI viewer | `await loadMacroDocumentWithRecovery('openapi')` |
| `src/forgeIndex.ts` (viewer branch) | Sequence/Mermaid/PlantUML viewer | `await loadMacroDocumentWithRecovery('sequence')` |
| `src/forge-graph-editor.ts` | Graph editor | same call; captures `originalCustomContentId`, `recoveryPageId` |
| `src/forge-swagger-editor.ts` | OpenAPI editor | same (swagger unwraps `extension.modal.customContentId` workaround locally before calling the helper) |
| `src/forgeIndex.ts` (editor branch) | Sequence/Mermaid/PlantUML editor | same |

`src/forge-embed-viewer.ts` and `src/forge-embed-editor.ts` are
intentionally **not** updated — embed is excluded from recovery (see
§2). They keep their existing main-branch behavior, which already
fires `reportOrphanObserved` with `recoveryUsed: false` semantics.

Each site falls through to `NULL_DIAGRAM` when `doc` is undefined. No
per-site telemetry, no per-site recovery branching — all centralized in
the helper.

### 5.4 Telemetry honesty fix

Even without Slice 2's repair logic, Slice 1 corrects two related
issues that exist on the un-merged PR #120:

1. The PR's editor save handler fires `reportOrphanMacroRepaired`
   whenever `originalCustomContentId !== id`, regardless of whether
   `view.submit({config:...})` actually rewrote the macro XML. From a
   modal-editor context the rewrite never happens, so the event is a
   false positive.
2. Slice 1 does not yet ship that save-side `view.submit` call (that's
   Slice 2), so the false-positive can't occur. But landing
   `canRepairMacroXml` in Slice 1 gives Slice 2 a clean predicate to
   gate both the submit and the telemetry on.

### 5.5 DebugBar editor-context badge

`src/components/Debug/DebugBar.vue` gains a new badge segment between
the product-variant chip and the dropdowns:

| Badge | When |
|---|---|
| `CONFIG-EDIT` (green) | `extension.macro.isConfiguring === true && !extension.modal` |
| `CONFIG-EDIT • INSERT` (green) | above + `extension.macro.isInserting === true` |
| `MODAL-EDIT` (orange) | `extension.modal?.macroMode === 'editor'` |
| `VIEWER` (gray) | none of the above |
| `FULLSCREEN` (purple) | `extension.modal?.macroMode === 'fullscreen'` |

Additional recovery marker (chip next to the badge) shown when
`store.state.diagram.recoveredFromOrphanId` is set, displayed as
`🧯 RECOVERED`. The chip is dev-only (DebugBar is gated by
`localStorage.zenumlDebug` and standalone mode); no production UI
impact.

### 5.6 Dev-site updates (`private/forge-macro-config/index.html`)

Two changes:

1. **Correction to §8.** The current sequence diagram on lines 668–675
   shows the modal-editor's `view.submit({config: …})` producing
   `Forge -> Forge: REPLACE parameters.guestParams = …`. That arrow is
   incorrect for the modal-editor case: empirically (per current
   author's testing), saves from a viewer-spawned modal-editor mutate
   the custom content (`PUT /custom-content/:id` succeeds) but do **not**
   mutate the macro XML. Replace the arrow with a note clarifying that
   the repair path requires re-entering via page-edit mode.

2. **New §8: Editor-context discrimination** (renumbering current
   §8 → §9). Content:
   - The four entry points and their `extension` shape (same table as
     §5.5's DebugBar badge mapping, expanded with the `Can repair macro
     XML?` column).
   - The `canRepairMacroXml` predicate.
   - Implications for orphan recovery (the repair `view.submit` and the
     viewer Edit button gate both depend on this predicate).
   - A short paragraph "Why we don't pass `recoveredId` via modal
     context" referencing §4's three-category table.

### 5.7 Modal-fallback observability

In both files that still carry the fallback, add a single tracked event
that fires only when the fallback would be load-bearing — i.e., when
`extension.config.customContentId` is undefined AND
`extension.modal.customContentId` is set:

```ts
const configId = context.extension?.config?.customContentId;
const modalId = context.extension?.modal?.customContentId;
const customContentId = configId || modalId;

// Slice 1 observability: detect cases where the fallback is actually
// the load-bearing source. If this event never fires for ≥1 week in
// production, the fallback can be removed in a separate release
// (see §9 future work).
if (!configId && modalId) {
  trackAnalyticsEvent('custom_content_id_modal_fallback_used', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: 'openapi', // 'sequence' for forgeIndex.ts
    content_id: modalId,
  });
}
```

Files to instrument:
- `src/forge-swagger-editor.ts` — `macro_type: 'openapi'`
- `src/forgeIndex.ts` (the sequence-editor branch around line 102) —
  `macro_type: 'sequence'`

Mixpanel event: `custom_content_id_modal_fallback_used`
Properties:
- `feature_area: 'macro'`
- `surface: 'editor'`
- `macro_type: 'openapi' | 'sequence'`
- `content_id: <the modalId>`

**Interpretation:**
- **Zero events over the observation window** → the fallback was never
  load-bearing in the observed period. Safe to remove (separate release,
  per §9). The empirical test on lite-dev that prompted this work then
  has corroborating production data.
- **Non-zero events** → the fallback IS load-bearing for some users /
  scenarios. The original commit claim was correct; do not remove the
  fallback. Investigate why `extension.config` is empty in those cases
  (specific module type? specific Confluence build? race condition with
  Forge platform initialization?).

The event is intentionally small-surface — single firing condition,
single new event name — so it's easy to query (`Mixpanel: events where
name = custom_content_id_modal_fallback_used`) and easy to roll back if
it generates more volume than expected.

### 5.8 Tests

- Unit tests for `loadCustomContentWithOrphanRecovery` in
  `ApWrapper2.spec.ts`:
  - Direct hit returns the CC unchanged.
  - 404 + missing `pageId` returns undefined with no probe call.
  - 404 + probe finds 0 candidates → undefined + probeResult.
  - 404 + probe finds 1 candidate → recovered CC + `recoveredFromOrphanId`.
  - 404 + probe finds ≥2 candidates → undefined + probeResult.
  - 404 + probe errors → undefined + probeResult with `probeError`.
  - 404 + candidate fetch returns undefined → undefined + probeResult.
- Unit tests for `loadMacroDocumentWithRecovery` (the new helper):
  - Missing `customContentId` returns `{ doc: undefined }` with no
    `reportOrphanObserved` call.
  - Direct hit returns `{ doc, originalCustomContentId, recoveryPageId }`
    with no recovery markers, no telemetry.
  - 1-candidate recovery returns recovered doc + `recoveredFromOrphanId`
    set, fires `reportOrphanObserved` with `{ recoveryUsed: true,
    recoveredId }`.
  - 0-candidate / ambiguous returns `{ doc: undefined }`, fires
    `reportOrphanObserved` with `{ recoveryUsed: false }`.
  - Reads `customContentId` from `extension.modal.customContentId` when
    `extension.config.customContentId` is absent.
- Update `orphanTelemetry.spec.ts` to cover the new payload variants
  (`recoveryUsed: true|false`, `recoveredId`).
- Per-entry-point tests can now be minimal: each entry asserts that the
  helper is called with the correct `kind` argument and its result is
  wired into the downstream rendering path. No need to re-test the
  recovery branches — those are covered once in the helper's spec.
- DebugBar visual: covered by existing standalone preview harness; no
  new spec needed.

## 6. Slice 2 — repair + UI gating

### 6.1 Editor save handler

In each of `src/forge-{embed,graph,swagger}-editor.ts` and the editor
branch of `src/forgeIndex.ts`, replace the existing save handler with:

```ts
EventBus.$on('save', async () => {
  // ... existing journey/analytics calls ...
  const id = store.state.diagram?.id;
  const canRepair = await canRepairMacroXml();
  const macroNeedsRepair = canRepair
    && !!originalCustomContentId
    && id
    && id !== originalCustomContentId;

  setTimeout(async () => {
    if (await isInserting() || macroNeedsRepair) {
      await (await getView()).submit({
        config: { customContentId: id, updatedAt: new Date().toISOString() },
      });
      if (macroNeedsRepair && originalCustomContentId) {
        reportOrphanMacroRepaired(
          recoveryPageId,
          originalCustomContentId,
          id,
          diagramKind,
        );
      }
    } else {
      await (await getView()).close();
    }
  }, /* existing tracking delay */);
});
```

Key change vs. PR #120: the `canRepair` gate. If the editor was loaded
via modal context, `macroNeedsRepair` is forced false, `view.close()`
runs, and no false-positive telemetry fires.

### 6.2 UI gating — disable viewer Edit on recovered diagrams

Extend the existing `isCopy` / `copyReason` mechanism rather than
introducing a parallel field.

In `src/model/Diagram/Diagram.ts`:

```ts
copyReason?: 'cross-page' | 'same-page-duplicate' | 'orphan-recovery';
```

In each viewer entry point (after `loadCustomContentWithOrphanRecovery`):

```ts
if (loaded.recoveredFromOrphanId && doc) {
  doc.isCopy = true;
  doc.copyReason = 'orphan-recovery';
}
```

In `src/components/Viewer/GenericViewer.vue`, extend `editDisabledReason`:

```ts
editDisabledReason() {
  if (!this.diagram.isCopy) return null;
  if (this.diagram.copyReason === 'orphan-recovery') {
    return 'This diagram was restored from a copy on this page. To edit it, open the page in edit mode.';
  }
  return this.diagram.copyReason === 'cross-page'
    ? 'This diagram lives on another page. Edit it there to keep both in sync.'
    : 'There are multiple copies of this diagram on this page. Edits affect all of them.';
}
```

The Edit button is already disabled (greyed out, `:disabled` bound)
when `editDisabledReason` is non-null; the existing tooltip mechanism
surfaces the message.

### 6.3 Why not also gate the fullscreen viewer

The fullscreen viewer hides Edit entirely (`v-if="showEdit && !isFullscreenMode"`,
line 24 of GenericViewer.vue), so the user can't reach the broken path
from fullscreen.

### 6.4 Tests

- Unit tests for the editor save handler:
  - Insert (no original CC id): `view.submit` fires, no
    `reportOrphanMacroRepaired`.
  - Normal edit (id matches original): `view.close()` fires, no repair.
  - Recovery edit in macro-config context (`canRepairMacroXml`
    returns true, id differs): `view.submit` fires, repair event fires.
  - Recovery edit in modal context (`canRepairMacroXml` returns false,
    id differs): `view.close()` fires, **no** repair event.
- Component test for `GenericViewer.editDisabledReason` covering all
  three `copyReason` literals (including the new one).
- Tests for the four viewer entry points: when loader returns
  `recoveredFromOrphanId`, the diagram has `isCopy === true` and
  `copyReason === 'orphan-recovery'`.

## 7. Telemetry

Two events. Both already exist (PR #119 / PR #120 telemetry); this
spec specifies their final payload shape and firing conditions.

### `customcontent_orphan_observed`

Already on main via PR #119. Slice 1 adds payload fields:

```
{
  page_id, custom_content_id, diagram_kind,
  probe_recoverable, probe_candidate_count, probe_page_children_total,
  probe_truncated?, probe_error?,
  // NEW in Slice 1:
  recovery_used: boolean,            // true iff loader returned a sibling
  recovered_id?: string,             // the sibling's id when recovery_used=true
}
```

Fires from every viewer/editor load that hits the orphan code path.

### `customcontent_orphan_macro_repaired`

Already declared in PR #120, but firing is unconditional. Slice 2
gates it on `canRepairMacroXml` returning true at the time of save.

```
{
  page_id, original_custom_content_id, repaired_custom_content_id,
  diagram_kind,
}
```

Fires exactly once per successful repair save. Never fires from a
modal-editor context.

## 8. Rollout

### Slice 1

1. New branch `feat/orphan-recovery-read-only` from latest `main`.
2. Cherry-pick the loader + probe candidateIds change + viewer/editor
   plumbing from `fix/zen-1170-defect-2b-recovery`, omitting the save
   handler changes.
3. Add `canRepairMacroXml`, DebugBar badge, dev-site updates.
4. Unit tests pass locally (`pnpm test:unit`).
5. PR opened, CI green, merged to main.
6. Staging auto-deploy + manual spot check on `lite-dev.atlassian.net`
   (forge tunnel): set up an orphan macro, open the page, confirm
   recovered render + `recovery_used: true` Mixpanel event.
7. Lite production release via `/release-app lite`.
8. Observation window 3–7 days. Confirm `recovery_used: true` event
   rate matches expected affected-tenant volume; no error spike.

### Slice 2

1. New branch `feat/orphan-recovery-repair-and-gate` from `main`
   (post-Slice-1 merge).
2. Implement editor save handler change, `isCopy`/`copyReason`
   extension, `editDisabledReason` branch, and tests.
3. PR opened with cross-link to Slice 1 PR for context.
4. Staging spot check: same orphan macro from Slice 1's check should
   now produce the disabled Edit button with the new tooltip; saving
   via page-edit mode should fire `orphan_macro_repaired` and the
   next view should render normally (no probe).
5. Lite production release.
6. Abandon `fix/zen-1170-defect-2b-recovery` (close PR if open).

### Reversibility

- Slice 1: revert by removing the loader call site and reverting
  viewers to `getCustomContentByIdV2` directly. No data cleanup.
- Slice 2: revert removes the disabled-Edit branch and the save-side
  repair. Already-repaired macros stay repaired (no rollback of the
  rewritten `guestParams.customContentId`). Future orphans go back to
  the Slice-1 telemetry-only behavior.

## 9. Open questions / future work

### Future release — remove the `extension.modal.customContentId` fallback

Two files carry the fallback today: `src/forge-swagger-editor.ts:196`
and `src/forgeIndex.ts:102`. Slice 1 §5.7 ships observability
(`custom_content_id_modal_fallback_used` Mixpanel event) to detect
whether the fallback is ever the load-bearing source in production.

**Removal criteria** (must be true before opening the cleanup PR):
- Observation window of **at least 7 days** with the
  observability event live in production for the lite variant.
- **Zero** `custom_content_id_modal_fallback_used` events in that
  window for both `macro_type: 'openapi'` and `macro_type: 'sequence'`.
- No new related orphan-recovery issues opened against either editor
  in that window.

**Cleanup PR scope** (when criteria met):
- Remove the `|| extension.modal.customContentId` from both files.
- Remove the observability event (the data has been collected).
- Update dev-site §7 to reflect the verified absence of the
  platform quirk.
- Add a CHANGELOG note.

**If criteria not met**: leave the fallback in place. Update the
inline comment in both files to record the date and Mixpanel event
count that justify keeping it. Re-evaluate after a Forge platform
release that might affect editor iframe context wiring.

### Other open items



- **Does the Slice 1 telemetry rate suggest Slice 2 urgency?**
  Decide based on real `recovery_used: true` volume after the
  observation window.
- **Should ambiguous-candidate cases ever get a user prompt?**
  Declined in this design. Revisit if `probe_candidate_count >= 2`
  events become non-trivial.
- **Should `isCopy`/`copyReason` eventually split into a separate
  `Diagram.recovery` field?**
  Acceptable to defer; the polymorphism is fine for one extra
  literal. Revisit if prior-version recovery or parse-failure
  recovery ever lands.
- **`extension.modal.macroMode === 'fullscreen'` and recovery
  interplay.**
  Fullscreen viewer already hides Edit, so no UI change needed. But
  the fullscreen path does load the macro: the loader runs there too,
  so the recovered diagram renders in fullscreen automatically. No
  action required; documented for completeness.

## 10. References

- PR #119 (merged): orphan telemetry probe.
- PR #120 (branch `fix/zen-1170-defect-2b-recovery`): the source
  branch we're splitting and amending.
- `private/forge-macro-config/index.html`: internal docs site; §7
  `extension.modal` passthrough, §8 (current) Defect 2b recovery.
- ZEN-1170: Jira ticket.
- `src/model/ApWrapper2.ts:336-410` (current branch): `probeOrphanRecovery`
  + `loadCustomContentWithOrphanRecovery` implementations to be
  cherry-picked.
