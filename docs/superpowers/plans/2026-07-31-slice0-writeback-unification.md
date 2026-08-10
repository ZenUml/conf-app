# Slice 0 — Writeback-Decision Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation subagents run on **Sonnet** (never Fable).

**Goal:** All three macro editors (Sequence via `forgeIndex.ts`, Graph, Swagger) make the save-time writeback decision through one shared derivation + one shared gate, fixing the live Graph/Swagger `view.submit`-in-modal bug.

**Architecture:** `src/model/writebackGate.ts` already owns the pure decision (`decideWriteback`). This slice adds a second pure function, `deriveWritebackSignals`, that owns the signal derivation currently triplicated with drift, then wires all three editors through `decideWriteback(deriveWritebackSignals(...))`. Deletes the two drifted inline copies.

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit`), existing E2E guard `tests/e2e-tests/tests/fullscreen/writeback-gate-non-submittable.spec.ts`.

**Spec:** `docs/superpowers/specs/2026-07-31-content-opening-unification-design.md` (Slice 0).

## Global Constraints

- Consistency and structural simplicity are the primary goals.
- When current code paths behave differently, choose one reasonable rule instead of preserving every historical variation with hooks and adapters.
- Small user-visible changes are acceptable if they result naturally from that simplification.
- Do not add states, fallbacks, telemetry, recovery UI, or other code merely to make behavior "better".
- Preserve only hard requirements: data integrity, authorization/paywall enforcement, essential legacy-content compatibility.
- Success means fewer concepts, fewer branches, and preferably less production code.
- **Branch from current `origin/main` only.** The long-lived feature workspaces are stale on these files. Work in a fresh worktree:
  `git worktree add ../conf-app-slice0 -b refactor/slice0-writeback-unification origin/main`
- No new Mixpanel events (existing `save_failed` / repair reporters untouched), so the analytics-first rule imposes no catalog change.
- Typecheck baseline is red on main (~150 pre-existing errors) — compare error count to main, don't chase zero.

## Accepted behavior changes (from the approved spec — do not "fix" these back)

1. Graph in-viewer Edit modal + forked id: was a `view.submit` throw ("not submittable", dialog sticks open) → becomes a clean `view.close()` with the draft preserved. This is the bug fix — a code-verified defect class; on current staging it sits behind `guardEditClick` and the load-time cross-page gate as a defense-in-depth floor (see Task 5 Step 3).
2. Swagger in-viewer Edit modal + forked id: same fix.
3. Swagger same-page orphan/uuid recovery now triggers the legacy-migration writeback on submittable surfaces (macro params get `customContentId` stamped, ending repeat tenant-wide title searches). Falls out of sharing the derivation; data-integrity positive.

---

### Task 1: `deriveWritebackSignals` in writebackGate.ts (TDD)

**Files:**
- Modify: `src/model/writebackGate.ts`
- Test: `src/model/writebackGate.spec.ts` (extend the existing file)

**Interfaces:**
- Consumes: existing `decideWriteback(s: WritebackSignals): WritebackDecision` and `WritebackSignals` (fields: `inserting, configuring, idChanged, macroNeedsRepair, legacyMacroNeedsRepair, hasId` — all boolean).
- Produces: `deriveWritebackSignals(i: WritebackDerivationInput): WritebackSignals` and
  `interface WritebackDerivationInput { inserting: boolean; configuring: boolean; sourceId: string; newId: string; originalCustomContentId?: string; docSource?: DataSource | string; recoveredFromOrphan?: boolean }`.
  Tasks 2–4 call exactly `decideWriteback(deriveWritebackSignals({ ...derivationInput, inserting, configuring }))`.

- [ ] **Step 1: Write the failing tests** — append to `src/model/writebackGate.spec.ts`:

```ts
import { deriveWritebackSignals } from './writebackGate';
import { DataSource } from './Diagram/Diagram';

// Slice 0 of the content-opening unification: the signal DERIVATION was
// triplicated across forgeIndex / forge-graph-editor / forge-swagger-editor,
// and the two editor copies also reimplemented the decision with drifted
// formulas (graph: `inserting || idChanged || attemptRepair ||
// attemptLegacyMigration`, swagger: same minus the legacy term) — both
// missing the #170 repairWillPersist gate on idChanged.
describe('deriveWritebackSignals (slice 0 — one derivation for all editors)', () => {
  const base = {
    inserting: false,
    configuring: false,
    sourceId: '111',
    newId: '111',
    originalCustomContentId: undefined as string | undefined,
    docSource: DataSource.CustomContent as DataSource | string,
    recoveredFromOrphan: false,
  };

  it('THE graph bug: modal surface + forked id must NOT write back', () => {
    // Graph's inline formula returned needsWriteback=true here and called
    // view.submit in a non-submittable surface ("not submittable" throw).
    const d = decideWriteback(deriveWritebackSignals({ ...base, newId: '222' }));
    expect(d.needsWriteback).toBe(false);
  });

  it('insert surface + forked id still writes back (gate must not over-suppress)', () => {
    const d = decideWriteback(deriveWritebackSignals({ ...base, inserting: true, newId: '222' }));
    expect(d.needsWriteback).toBe(true);
  });

  it('the swagger gap: same-page recovery on a submittable surface triggers legacy migration', () => {
    const s = deriveWritebackSignals({ ...base, configuring: true, recoveredFromOrphan: true });
    expect(s.legacyMacroNeedsRepair).toBe(true);
    const d = decideWriteback(s);
    expect(d.attemptLegacyMigration).toBe(true);
    expect(d.needsWriteback).toBe(true);
  });

  it('content-property legacy doc migrates on insert save', () => {
    const s = deriveWritebackSignals({ ...base, inserting: true, docSource: DataSource.ContentProperty });
    expect(s.legacyMacroNeedsRepair).toBe(true);
    expect(decideWriteback(s).attemptLegacyMigration).toBe(true);
  });

  it('orphan-recovered sibling id sets macroNeedsRepair, not idChanged', () => {
    const s = deriveWritebackSignals({ ...base, originalCustomContentId: '999', sourceId: '222', newId: '222' });
    expect(s.macroNeedsRepair).toBe(true);
    expect(s.idChanged).toBe(false);
  });

  it('a recovered doc with a surviving original id is repair, never legacy migration', () => {
    const s = deriveWritebackSignals({ ...base, originalCustomContentId: '999', recoveredFromOrphan: true, newId: '222' });
    expect(s.legacyMacroNeedsRepair).toBe(false);
    expect(s.macroNeedsRepair).toBe(true);
  });

  it('empty newId suppresses hasId and therefore legacy migration', () => {
    const s = deriveWritebackSignals({ ...base, inserting: true, newId: '', docSource: DataSource.ContentProperty });
    expect(s.hasId).toBe(false);
    expect(decideWriteback(s).attemptLegacyMigration).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit src/model/writebackGate.spec.ts`
Expected: FAIL — `deriveWritebackSignals` is not exported.

- [ ] **Step 3: Implement** — append to `src/model/writebackGate.ts` (add the import at the top):

```ts
import { DataSource } from './Diagram/Diagram';
```

```ts
// Signal derivation shared by the three macro editors (slice 0 of the
// content-opening unification). Callers pass their own doc handle's fields
// (forgeIndex: store.state.diagram; graph/swagger: window.diagram) captured
// BEFORE any deferred writeback runs.
export interface WritebackDerivationInput {
  inserting: boolean;
  configuring: boolean;
  /** custom-content id loaded into the editor ('' when none). */
  sourceId: string;
  /** id returned by saveToPlatform ('' when save produced none). */
  newId: string;
  /** original macro-config id when orphan recovery loaded a sibling. */
  originalCustomContentId?: string;
  /** DataSource of the doc the editor mounted. */
  docSource?: DataSource | string;
  /** the mounted doc came through the uuid/orphan recovery chain. */
  recoveredFromOrphan?: boolean;
}

export function deriveWritebackSignals(i: WritebackDerivationInput): WritebackSignals {
  return {
    inserting: i.inserting,
    configuring: i.configuring,
    idChanged: !!i.sourceId && !!i.newId && i.newId !== i.sourceId,
    // ZEN-1170 Defect 2b: saved against a recovered sibling id.
    macroNeedsRepair: !!(i.originalCustomContentId && i.newId && i.newId !== i.originalCustomContentId),
    // ZEN-1170 Defect 1 + PR #139 same-page recovery: uuid-only macro whose
    // doc came from a legacy source — stamp customContentId on first save.
    legacyMacroNeedsRepair:
      !i.originalCustomContentId &&
      (i.docSource === DataSource.ContentProperty ||
        i.docSource === DataSource.ContentPropertyOld ||
        (i.docSource === DataSource.CustomContent && !!i.recoveredFromOrphan)),
    hasId: !!i.newId,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:unit src/model/writebackGate.spec.ts`
Expected: PASS (all pre-existing tests too).

- [ ] **Step 5: Commit**

```bash
git add src/model/writebackGate.ts src/model/writebackGate.spec.ts
git commit -m "refactor(writeback): shared signal derivation — the three editors' copies had drifted"
```

---

### Task 2: Wire forge-graph-editor.ts through the shared gate

**Files:**
- Modify: `src/forge-graph-editor.ts` (inside `saveGraphAndExit`, the block from `const macroNeedsRepair =` through the first five lines of the `setTimeout` callback)

**Interfaces:**
- Consumes: `decideWriteback`, `deriveWritebackSignals` from `@/model/writebackGate` (Task 1 signatures).
- Produces: no new exports; `saveGraphAndExit` behavior per "Accepted behavior changes" #1.

- [ ] **Step 1: Add the import** at the top of `src/forge-graph-editor.ts`:

```ts
import { decideWriteback, deriveWritebackSignals } from "@/model/writebackGate";
```

- [ ] **Step 2: Replace the inline derivation + formula.** Delete the `const macroNeedsRepair = ...` statement and the entire `const legacyMacroNeedsRepair = ...` statement (including their ZEN-1170 comment blocks — the rationale now lives once in `writebackGate.ts`), and replace with:

```ts
  // Capture derivation inputs now — window.diagram may move under the
  // deferred writeback below.
  const derivationInput = {
    sourceId,
    newId: id,
    originalCustomContentId,
    docSource: window.diagram?.source,
    recoveredFromOrphan: !!(window.diagram as any)?.recoveredFromOrphan,
  };
```

Then inside the `setTimeout` callback, replace these five lines:

```ts
    const repairWillPersist = inserting || configuring;
    const attemptRepair = repairWillPersist && macroNeedsRepair;
    const attemptLegacyMigration = repairWillPersist && legacyMacroNeedsRepair && !!id;
    const idChanged = !!sourceId && !!id && id !== sourceId;
    const needsWriteback = inserting || idChanged || attemptRepair || attemptLegacyMigration;
```

with:

```ts
    const { attemptRepair, attemptLegacyMigration, needsWriteback } = decideWriteback(
      deriveWritebackSignals({ ...derivationInput, inserting, configuring })
    );
```

The `const [inserting, configuring] = ...` line above them and everything from `trackPublishCompleted(...)` down (including the `isValidCustomContentId` guard, the submit config, `reportOrphanMacroRepaired`, `reportLegacyContentPropertyMacroRepaired`) stays byte-identical — they consume `attemptRepair` / `attemptLegacyMigration` / `needsWriteback` / `inserting`, all still in scope.

- [ ] **Step 3: Verify** — run `pnpm test:unit` (green) and `npx vue-tsc --noEmit 2>&1 | grep -c 'error TS'` (count ≤ main's baseline; `forge-graph-editor.ts` must contribute no NEW errors — check with `npx vue-tsc --noEmit 2>&1 | grep forge-graph-editor`).

- [ ] **Step 4: Commit**

```bash
git add src/forge-graph-editor.ts
git commit -m "fix(graph): adopt the #170 writeback gate — modal+forked-id no longer calls view.submit"
```

---

### Task 3: Wire forge-swagger-editor.ts through the shared gate

**Files:**
- Modify: `src/forge-swagger-editor.ts` (inside `saveOpenApiAndExit`, same block shape as Task 2)

**Interfaces:**
- Consumes: `decideWriteback`, `deriveWritebackSignals` from `@/model/writebackGate`.
- Produces: no new exports; behavior per "Accepted behavior changes" #2 and #3.

- [ ] **Step 1: Add the import** at the top of `src/forge-swagger-editor.ts`:

```ts
import { decideWriteback, deriveWritebackSignals } from "@/model/writebackGate";
```

- [ ] **Step 2: Replace the inline derivation + formula.** Delete the `const macroNeedsRepair = ...` statement (and its ZEN-1170 comment block) and insert in its place:

```ts
  // Capture derivation inputs now — window.diagram may move under the
  // deferred writeback below.
  const derivationInput = {
    sourceId,
    newId: id,
    originalCustomContentId,
    // @ts-ignore
    docSource: window.diagram?.source,
    recoveredFromOrphan: !!(window.diagram as any)?.recoveredFromOrphan,
  };
```

Then inside the `setTimeout` callback, replace these four lines:

```ts
    const repairWillPersist = inserting || configuring;
    const attemptRepair = repairWillPersist && macroNeedsRepair;
    const idChanged = !!sourceId && !!id && id !== sourceId;
    const needsWriteback = inserting || idChanged || attemptRepair;
```

with:

```ts
    const { attemptRepair, needsWriteback } = decideWriteback(
      deriveWritebackSignals({ ...derivationInput, inserting, configuring })
    );
```

Note the destructure omits `attemptLegacyMigration` — swagger's submit block has no legacy-migration reporter and gains none (Global Constraints: no telemetry added). The term still participates in `needsWriteback` inside `decideWriteback`, which is what delivers behavior change #3.

- [ ] **Step 3: Verify** — `pnpm test:unit` green; `npx vue-tsc --noEmit 2>&1 | grep forge-swagger-editor` shows no NEW errors vs main.

- [ ] **Step 4: Commit**

```bash
git add src/forge-swagger-editor.ts
git commit -m "fix(swagger): adopt the #170 writeback gate and the legacy-migration term graph already had"
```

---

### Task 4: Fold forgeIndex.ts's derivation into the shared function

**Files:**
- Modify: `src/forgeIndex.ts` (the save handler: the `const macroNeedsRepair = ...` / `const legacyMacroNeedsRepair = ...` statements and the `decideWriteback({...})` call ~30 lines below them)

**Interfaces:**
- Consumes: `deriveWritebackSignals` (Task 1). `forgeIndex.ts` already imports `decideWriteback` from `@/model/writebackGate` — extend that import.
- Produces: no new exports; zero behavior change (forgeIndex's derivation is the reference the shared function was written from).

- [ ] **Step 1: Confirm the deletions are safe.** Run `grep -n 'macroNeedsRepair\|legacyMacroNeedsRepair\|idChanged' src/forgeIndex.ts` — the only uses must be the two `const` definitions, the `idChanged` definition inside the async writeback block, and the `decideWriteback({...})` argument list. If anything else consumes them, STOP and report instead of proceeding.

- [ ] **Step 2: Replace.** Extend the import to `import { decideWriteback, deriveWritebackSignals } from "@/model/writebackGate";`. Delete the `const macroNeedsRepair = ...` and `const legacyMacroNeedsRepair = ...` statements (keep a one-line pointer comment: `// Writeback signal derivation: see deriveWritebackSignals in @/model/writebackGate.`). Inside the writeback block, delete `const idChanged = ...` and replace the `decideWriteback({ inserting, configuring, idChanged, macroNeedsRepair, legacyMacroNeedsRepair, hasId: !!id })` call with:

```ts
    const { attemptRepair, attemptLegacyMigration, needsWriteback } = decideWriteback(
      deriveWritebackSignals({
        sourceId,
        newId: id,
        originalCustomContentId,
        docSource: store.state.diagram?.source,
        recoveredFromOrphan: !!(store.state.diagram as any)?.recoveredFromOrphan,
        inserting,
        configuring,
      })
    );
```

(Keep the destructured names identical to the existing call site's consumers.)

- [ ] **Step 3: Verify** — `pnpm test:unit` green; `npx vue-tsc --noEmit 2>&1 | grep forgeIndex` shows no NEW errors vs main.

- [ ] **Step 4: Commit**

```bash
git add src/forgeIndex.ts
git commit -m "refactor(sequence): fold the save-handler signal derivation into deriveWritebackSignals"
```

---

### Task 5: Validate and ship

**Files:** none new.

- [ ] **Step 1:** Run the repo's validate-branch skill (`/validate-branch`) — unit tests, lint, typecheck-vs-main, build.
- [ ] **Step 2:** Ship via the repo pipeline (`/ship-branch`): PR against `main`, CI green (the authoritative `pull_request` run — a `CANCELLED` sibling `push` run is normal), merge. The existing E2E guard `tests/e2e-tests/tests/fullscreen/writeback-gate-non-submittable.spec.ts` must be green in CI — it covers the Sequence surface of exactly this gate.
- [ ] **Step 3:** Per the spec's delivery gates, after the staging deploy run a NON-REGRESSION spot check: edit a normal Graph diagram via the in-viewer Edit modal on staging, save, confirm it saves and the dialog closes cleanly. Note this check passes identically on the pre-fix code — the normal edit path takes the in-place update (id unchanged) on both versions. The fork-producing shapes (same-page duplicate count > 1; cross-page copy) are blocked ahead of the modal by `guardEditClick` and the load-time gate, so no staging repro of the fixed path is known; the residual reachable shape is a container-less custom content (missing `pageId`). The #170 gate this branch adopts is therefore a defense-in-depth floor behind those guards, pinned by `src/model/writebackGate.spec.ts` — not a user-visible staging-verifiable fix.

## Ledger impact (spec acceptance table)

- Writeback decisions: 3 (two defective) → 1. Derivations: 3 → 1.
- Production LOC: measured net +13 across the four src/ files (+82/−69) — within the spec's "modestly positive" allowance; the countable wins are the point: writeback decisions 3 → 1, derivations 3 → 1.
- Live defect fixed: Graph/Swagger modal `view.submit` throw.
