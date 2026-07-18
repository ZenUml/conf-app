# Diagram Source Snapshot Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make diagram macros survive loss of their source custom content (source page deleted/restricted, cross-page copies going dark) by writing a per-page JSON source-snapshot attachment — the DrawIO-verified resilience model — created in user context at the two moments permission is guaranteed (macro save; editor-preview render of a cross-page alias), and read back as a viewer render fallback when the CC is unreachable.

**Architecture:** A new `SnapshotAttachment` module owns the snapshot format, naming (`zenuml-<ccId>.json`, sibling of the existing `zenuml-<ccId>.png`), upload (v1 attachment PUT, upsert-by-filename) and fetch (v2 attachments-by-filename + download). Three wiring points: (1) editor save chain also uploads the JSON snapshot; (2) editor-preview render of a cross-page alias backfills the snapshot onto the host page; (3) the viewer load chain, after CC fetch + orphan recovery + legacy-property fallback all fail, mounts the diagram from the host page's snapshot with a notice banner. No page-body writes, no backend, no new storage system — all official Confluence APIs in user context.

**Tech Stack:** Vue 3 + TypeScript, Vitest (`pnpm test:unit <path>`), `@forge/bridge` `requestConfluence` (via `forgeRequest` in `src/utils/requestUtil.ts`), existing `ApWrapper2.getAttachmentsV2`.

**Background:** `private/client-profiles/research/drawio-copy-behaviour.html` (verified DrawIO model, 2026-05-27); issues #140 (XML-in-PNG for graph), #212 (save-time attachment creation, completed 2026-06-20), #211/#162 (why viewer-triggered uploads are unreliable — this plan writes only from permission-guaranteed surfaces).

## Global Constraints

- **Snapshot scope: `DiagramType.Sequence`, `DiagramType.Mermaid`, `DiagramType.PlantUml` ONLY.** Graph is excluded (XML already embedded in the PNG per #140); Embed/OpenApi/AsyncApi excluded (YAGNI).
- **Attachment name: `zenuml-<customContentId>.json`** — derived ONLY from the macro's existing `customContentId` param. Never store a filename in macro config (macro params are not writable outside the config surface).
- Snapshot must never block or fail a save/render: every snapshot operation is wrapped, failures degrade to today's behavior + a failure analytics event.
- Invalid ccId guard: reuse `isValidCustomContentId` (`src/utils/customContentId.ts`) before building any attachment name (prevents `zenuml-undefined.json` collisions — same guard the PNG path has at `Attachment.ts:688`).
- Analytics events are Task 1 and land as the first commit (repo policy). Register names in `src/utils/analytics/catalog.ts` `AnalyticsEventName` union; use `trackAnalyticsEvent` (`src/utils/analytics/trackAnalyticsEvent.ts` — check exact import path used by `Persistence.ts`).
- Pure Forge: no `AP.*`, no Connect hosts. All HTTP via `forgeRequest` / `requestConfluence`.
- No client/tenant names in any file (client-privacy hard rule).
- Never commit to `main`. Work in a git worktree branch created from **origin/main** (`git fetch origin` first; local mains go stale). One-line commit subjects, no body.
- Typecheck baseline is red (~150 pre-existing errors): compare `npx vue-tsc --noEmit 2>&1 | wc -l` against origin/main before blaming your change.
- Unit tests: `pnpm test:unit <path>`. Do not run E2E for this plan.

## File Structure

- `src/utils/analytics/catalog.ts`, `src/utils/analytics/types.ts` — new event names + properties (Task 1).
- `src/model/SnapshotAttachment.ts` (+ `.spec.ts`) — NEW, the entire snapshot domain: types, naming, build, upload, fetch (Task 2).
- Save chain wiring (Task 3): `src/components/Header/Header.vue` save/publish chain (the `saveToPlatform → attachment upload → view.submit` sequence, comment near line 69) or `src/model/ContentProvider/Persistence.ts` after successful save (`savedId` known, ~line 92) — implementer picks the site where BOTH the saved `customContent.id` and the `Diagram` are in scope and the upload completes before `view.submit` teardown.
- `src/forgeIndex.ts` — editor-preview backfill (Task 4) + viewer fallback (Task 5). **Tasks 4 and 5 both touch this file — see Execution Split.**
- `src/model/Diagram/Diagram.ts` — `snapshotFallback?: boolean; snapshotAt?: string;` (Task 5).
- `src/components/Viewer/GenericViewer.vue` — snapshot notice + load-failed copy fix (Task 6).

## Execution Split (two implementers)

- **Workstream WRITE (Tasks 1–4)** — branch `feat/snapshot-write`.
- **Workstream READ (Tasks 5–6)** — branch `feat/snapshot-read`. Depends on the `SnapshotAttachment` module interface (Task 2). If the module file does not exist on your branch yet, create it with EXACTLY the Task 2 code (identical content merges cleanly; the WRITE branch lands first and READ rebases, dropping the duplicate).
- Both branches: PR to `ZenUml/conf-app`, do NOT merge. The orchestrator handles merge order (WRITE first, READ rebased on top).

---

### Task 1: Analytics vocabulary

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (append to `AnalyticsEventName` union, line ~80)
- Modify: `src/utils/analytics/types.ts` (append optional properties to `AnalyticsProperties`)

**Interfaces:**
- Produces: event names `'snapshot_created' | 'snapshot_create_failed' | 'snapshot_fallback_rendered'`; properties `snapshot_trigger?: 'save' | 'editor_backfill'`, `attachment_name?: string` (may already exist — check; `Persistence.ts` already sends `attachment_name`), `snapshot_age_days?: number`.

- [ ] **Step 1: Add the three event names** to the `AnalyticsEventName` union following the file's existing grouping/comment style:

```typescript
  // Diagram source snapshot attachments (resilience for cross-page copies /
  // deleted source pages — see docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md)
  | 'snapshot_created'
  | 'snapshot_create_failed'
  | 'snapshot_fallback_rendered'
```

- [ ] **Step 2: Add properties** to `AnalyticsProperties` in `types.ts` (skip any that already exist):

```typescript
  // Snapshot attachments: which flow wrote it, and fallback freshness.
  snapshot_trigger?: 'save' | 'editor_backfill';
  snapshot_age_days?: number;
```

- [ ] **Step 3: Verify compile is no worse than origin/main**: `npx vue-tsc --noEmit 2>&1 | wc -l` — identical count to origin/main.
- [ ] **Step 4: Commit**: `git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts && git commit -m "feat(analytics): declare snapshot attachment events"`

---

### Task 2: SnapshotAttachment module

**Files:**
- Create: `src/model/SnapshotAttachment.ts`
- Test: `src/model/SnapshotAttachment.spec.ts`

**Interfaces (later tasks import exactly these):**

```typescript
export interface DiagramSnapshotV1 {
  version: 1;
  ccId: string;
  ccVersion?: number;
  diagramType: string;      // DiagramType enum value
  title?: string;
  dsl: string;              // getCodeFromDiagram output
  snapshotAt: string;       // ISO timestamp
}
export function snapshotAttachmentName(ccId: string): string | undefined;
export function buildSnapshot(diagram: Diagram, ccId: string, ccVersion?: number): DiagramSnapshotV1 | undefined;
export async function uploadSnapshot(pageId: string, snapshot: DiagramSnapshotV1): Promise<void>; // throws on failure
export async function fetchSnapshot(pageId: string, ccId: string): Promise<DiagramSnapshotV1 | undefined>; // undefined on any failure
```

- [ ] **Step 1: Write the failing tests** (`src/model/SnapshotAttachment.spec.ts`) — follow the repo's existing Vitest patterns (see `src/model/ApWrapper2.spec.ts` for mocking style):

```typescript
import { describe, it, expect } from 'vitest';
import { snapshotAttachmentName, buildSnapshot } from './SnapshotAttachment';
import { DiagramType } from './Diagram/Diagram';

describe('snapshotAttachmentName', () => {
  it('derives the name from the ccId', () => {
    expect(snapshotAttachmentName('12345')).toBe('zenuml-12345.json');
  });
  it('refuses invalid ccIds (undefined/null/empty writeback corruption)', () => {
    expect(snapshotAttachmentName('undefined')).toBeUndefined();
    expect(snapshotAttachmentName('')).toBeUndefined();
  });
});

describe('buildSnapshot', () => {
  it('builds a v1 snapshot for a mermaid diagram', () => {
    const snap = buildSnapshot(
      { diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD; A-->B', title: 'T' } as any,
      '12345', 7,
    );
    expect(snap).toMatchObject({
      version: 1, ccId: '12345', ccVersion: 7,
      diagramType: DiagramType.Mermaid, dsl: 'graph TD; A-->B',
    });
    expect(typeof snap!.snapshotAt).toBe('string');
  });
  it('returns undefined for unsupported types (graph) and empty DSL', () => {
    expect(buildSnapshot({ diagramType: DiagramType.Graph, graphXml: '<x/>' } as any, '1')).toBeUndefined();
    expect(buildSnapshot({ diagramType: DiagramType.Sequence, code: '' } as any, '1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**: `pnpm test:unit src/model/SnapshotAttachment.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the module**:

```typescript
import { Diagram, DiagramType } from '@/model/Diagram/Diagram';
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig';
import { isValidCustomContentId } from '@/utils/customContentId';
import { forgeRequest } from '@/utils/requestUtil';
import globals from '@/model/globals';

const SNAPSHOT_TYPES: ReadonlyArray<DiagramType> = [
  DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml,
];

export interface DiagramSnapshotV1 { /* as in Interfaces block above */ }

export function snapshotAttachmentName(ccId: string): string | undefined {
  if (!isValidCustomContentId(ccId)) return undefined;
  return `zenuml-${ccId}.json`;
}

export function buildSnapshot(diagram: Diagram, ccId: string, ccVersion?: number): DiagramSnapshotV1 | undefined {
  if (!isValidCustomContentId(ccId)) return undefined;
  if (!SNAPSHOT_TYPES.includes(diagram.diagramType)) return undefined;
  const dsl = getCodeFromDiagram(diagram, diagram.diagramType);
  if (!dsl) return undefined;
  return {
    version: 1, ccId, ccVersion,
    diagramType: String(diagram.diagramType),
    title: diagram.title, dsl,
    snapshotAt: new Date().toISOString(),
  };
}

// v1 attachment PUT upserts by filename (no 409 on existing name — the #75
// class of collision), minorEdit suppresses page-activity noise.
export async function uploadSnapshot(pageId: string, snapshot: DiagramSnapshotV1): Promise<void> {
  const name = snapshotAttachmentName(snapshot.ccId);
  if (!name) throw new Error('invalid ccId for snapshot');
  const form = new FormData();
  form.append('file', new File([JSON.stringify(snapshot)], name, { type: 'application/json' }));
  form.append('minorEdit', 'true');
  const { requestConfluence } = await import('@forge/bridge');
  const res = await requestConfluence(
    `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`,
    { method: 'PUT', headers: { 'X-Atlassian-Token': 'nocheck' }, body: form },
  );
  if (!res.ok) throw new Error(`snapshot upload HTTP ${res.status}`);
}

export async function fetchSnapshot(pageId: string, ccId: string): Promise<DiagramSnapshotV1 | undefined> {
  try {
    const name = snapshotAttachmentName(ccId);
    if (!name) return undefined;
    const attachments = await globals.apWrapper.getAttachmentsV2(pageId, { filename: name });
    const download = attachments?.[0]?._links?.download;
    if (!download) return undefined;
    const { requestConfluence } = await import('@forge/bridge');
    const res = await requestConfluence(`/wiki${download}`);
    if (!res.ok) return undefined;
    const parsed = JSON.parse(await res.text());
    if (parsed?.version !== 1 || !parsed?.dsl || !parsed?.diagramType) return undefined;
    return parsed as DiagramSnapshotV1;
  } catch {
    return undefined;
  }
}
```

**Implementation notes (read before coding):** (a) confirm `globals.apWrapper.getAttachmentsV2` signature at its definition in `ApWrapper2.ts` and its `_links.download` shape at the existing call sites `src/model/Attachment.ts:437,528`; (b) the download link may already start with `/download/...` relative to `/wiki` — match `getAttachmentDownloadLink` (`Attachment.ts:432`) handling; (c) if the v1 attachment PUT rejects through the Forge proxy (410 class), fall back to the exact endpoint the existing PNG upload uses — read `postAttachmentAsUser` (`Attachment.ts:369`) and mirror it; unit-test with mocked transport either way.

- [ ] **Step 4: Run tests** → PASS. `pnpm test:unit src/model/SnapshotAttachment.spec.ts`
- [ ] **Step 5: Commit**: `git commit -m "feat(snapshot): SnapshotAttachment module — build/upload/fetch zenuml-<ccId>.json"`

---

### Task 3: Save-path wiring

**Files:**
- Modify: the save/publish chain — locate the existing #212 save-time PNG attachment call: `grep -rn "attachment" src/components/Header/Header.vue src/model/ContentProvider/Persistence.ts`. Add the JSON snapshot upload alongside it (same stage: after successful save, before `view.submit` teardown).
- Test: extend the nearest existing spec (`Persistence.spec.ts` if present, else add `src/model/ContentProvider/Persistence.snapshot.spec.ts`).

**Interfaces:**
- Consumes: `buildSnapshot`, `uploadSnapshot`, `snapshotAttachmentName` (Task 2); the saved `customContent.id` + `Diagram` in the save flow (`Persistence.ts` has both at ~line 92, where `savedId` is computed).

- [ ] **Step 1: Failing test** — mock `SnapshotAttachment` and assert the save flow calls `uploadSnapshot` with the saved id's snapshot for a mermaid save, and does NOT call it for a graph save; assert a thrown upload does not reject the save.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — inside the save success path:

```typescript
// Fire-and-forget within the save stage: snapshot failure must never fail the save.
try {
  const snapshot = buildSnapshot(diagram, savedId, customContent.version?.number);
  if (snapshot && pageId) {
    await uploadSnapshot(pageId, snapshot);
    trackAnalyticsEvent('snapshot_created', {
      feature_area: 'macro', surface: 'editor', macro_type: macroType,
      snapshot_trigger: 'save', custom_content_id: savedId,
      attachment_name: snapshotAttachmentName(savedId),
    });
  }
} catch (e) {
  trackAnalyticsEvent('snapshot_create_failed', {
    feature_area: 'macro', surface: 'editor', macro_type: macroType,
    snapshot_trigger: 'save', custom_content_id: savedId,
    error_message: String(e instanceof Error ? e.message : e).substring(0, 200),
  });
}
```

`pageId`: same source the PNG path uses (current page id from forge context — see `buildUploadContext` in `Attachment.ts:273`). Match the surrounding code's variable names.

- [ ] **Step 4: Tests pass**; **Step 5: Commit**: `git commit -m "feat(snapshot): write source snapshot on macro save"`

---

### Task 4: Editor-preview cross-page backfill

**Files:**
- Modify: `src/forgeIndex.ts` — after the CC load resolves (the `loadCustomContentWithOrphanRecovery` block, ~line 242) add a non-blocking backfill hook.
- Test: `src/utils/viewerLoad/` has spec patterns; add `src/model/SnapshotAttachment.backfill.spec.ts` for the extracted helper.

**Interfaces:**
- Consumes: Task 2 module; `loaded.customContent.pageId`, `recoveryPageId`, `!globals.apWrapper.isDisplayMode()` (editor-preview surface; see `forgeIndex.ts:647` for the display-mode gate the PNG path uses).
- Produces: exported helper `maybeBackfillSnapshot(opts: { hostPageId: string; ccId: string; ccPageId?: string | number; diagram: Diagram; ccVersion?: number; isDisplayMode: boolean }): Promise<void>` — put it in `SnapshotAttachment.ts` so Task 5's implementer never touches it.

- [ ] **Step 1: Failing tests** for `maybeBackfillSnapshot`: creates when (editor surface + cross-page + no existing snapshot); skips when display mode; skips when same page; skips when a fresh snapshot exists (existing `ccVersion >= current`); updates when stale; never throws (all failures → `snapshot_create_failed`).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** in `SnapshotAttachment.ts`:

```typescript
export async function maybeBackfillSnapshot(opts: {
  hostPageId: string; ccId: string; ccPageId?: string | number;
  diagram: Diagram; ccVersion?: number; isDisplayMode: boolean;
}): Promise<void> {
  try {
    if (opts.isDisplayMode) return;                       // editor surfaces only (write perms guaranteed)
    if (!opts.ccPageId || String(opts.ccPageId) === String(opts.hostPageId)) return; // cross-page aliases only
    const existing = await fetchSnapshot(opts.hostPageId, opts.ccId);
    if (existing && opts.ccVersion !== undefined && (existing.ccVersion ?? -1) >= opts.ccVersion) return;
    const snapshot = buildSnapshot(opts.diagram, opts.ccId, opts.ccVersion);
    if (!snapshot) return;
    await uploadSnapshot(opts.hostPageId, snapshot);
    trackAnalyticsEvent('snapshot_created', {
      feature_area: 'macro', surface: 'editor',
      snapshot_trigger: 'editor_backfill', custom_content_id: opts.ccId,
    });
  } catch (e) {
    trackAnalyticsEvent('snapshot_create_failed', {
      feature_area: 'macro', surface: 'editor',
      snapshot_trigger: 'editor_backfill', custom_content_id: opts.ccId,
      error_message: String(e instanceof Error ? e.message : e).substring(0, 200),
    });
  }
}
```

Wire in `forgeIndex.ts` right after `doc` is assigned from `loaded.customContent` (fire-and-forget, do NOT await on the critical path):

```typescript
if (doc && loaded.customContent) {
  import('@/model/SnapshotAttachment').then(({ maybeBackfillSnapshot }) =>
    maybeBackfillSnapshot({
      hostPageId: String(recoveryPageId), ccId: String(customContentId),
      ccPageId: loaded.customContent!.pageId, diagram: doc!,
      ccVersion: loaded.customContent!.version?.number,
      isDisplayMode: globals.apWrapper.isDisplayMode(),
    })).catch(e => console.debug('[snapshot] backfill skipped', e));
}
```

- [ ] **Step 4: Tests pass**; **Step 5: Commit**: `git commit -m "feat(snapshot): editor-preview backfill for cross-page aliases"`

---

### Task 5: Viewer snapshot fallback (READ workstream)

**Files:**
- Modify: `src/model/Diagram/Diagram.ts` — add to the `Diagram` interface: `snapshotFallback?: boolean; snapshotAt?: string;`
- Modify: `src/forgeIndex.ts` — in the load chain, after BOTH the CC/orphan-recovery path (~line 242) and the legacy content-property fallback (`if (!doc && storageUuid)` block, ~line 268) have failed to produce `doc`, and before NULL_DIAGRAM mounting.
- Test: `src/forgeIndex` load logic is hard to unit-test directly — extract the fallback into `SnapshotAttachment.ts` as `snapshotToDiagram` and test that; wire-up is a thin call.

**Interfaces:**
- Consumes: `fetchSnapshot` (Task 2).
- Produces: `export function snapshotToDiagram(snapshot: DiagramSnapshotV1): Diagram` in `SnapshotAttachment.ts`.

- [ ] **Step 1: Failing tests** for `snapshotToDiagram`: maps `dsl` back to the per-type field (`Sequence→code`, `Mermaid→mermaidCode`, `PlantUml→plantumlCode` — mirror `DIAGRAM_TYPE_TO_MACRO_TYPE` in `Persistence.ts`), sets `snapshotFallback: true`, `snapshotAt`, `title`, and `id` = ccId; unknown `diagramType` string → returns diagram typed `DiagramType.Unknown` (caller drops it).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement**:

```typescript
const DSL_FIELD: Record<string, 'code' | 'mermaidCode' | 'plantUmlCode'> = {
  [DiagramType.Sequence]: 'code',
  [DiagramType.Mermaid]: 'mermaidCode',
  [DiagramType.PlantUml]: 'plantUmlCode',
};
// NOTE: verify the exact PlantUml field name against the Diagram model /
// DiagramTypeConfig (`plantUmlCode` vs `plantumlCode`) before coding.

export function snapshotToDiagram(snapshot: DiagramSnapshotV1): Diagram {
  const field = DSL_FIELD[snapshot.diagramType];
  const diagram: any = {
    diagramType: field ? snapshot.diagramType : DiagramType.Unknown,
    title: snapshot.title,
    id: snapshot.ccId,
    snapshotFallback: true,
    snapshotAt: snapshot.snapshotAt,
  };
  if (field) diagram[field] = snapshot.dsl;
  return diagram as Diagram;
}
```

Wire in `forgeIndex.ts` after the legacy-property fallback block:

```typescript
// Snapshot-attachment fallback (docs/superpowers/plans/2026-07-18-…md):
// the CC is unreachable (deleted source page or no read access — the API
// returns NOT_FOUND for both) and no legacy body exists. Render the host
// page's own snapshot so the macro doesn't go dark.
if (!doc && customContentId && recoveryPageId) {
  const { fetchSnapshot, snapshotToDiagram } = await import('@/model/SnapshotAttachment');
  const snapshot = await fetchSnapshot(String(recoveryPageId), String(customContentId));
  if (snapshot) {
    const restored = snapshotToDiagram(snapshot);
    if (restored.diagramType !== DiagramType.Unknown) {
      doc = restored;
      const ageDays = Math.floor((Date.now() - new Date(snapshot.snapshotAt).getTime()) / 86400000);
      trackAnalyticsEvent('snapshot_fallback_rendered', {
        feature_area: 'macro', surface: 'viewer',
        custom_content_id: String(customContentId), snapshot_age_days: ageDays,
      });
    }
  }
}
```

Match the surrounding block's actual variable names and `trackAnalyticsEvent` import; keep `renderPerf` timing out of this branch.

- [ ] **Step 4: Tests pass**; **Step 5: Commit**: `git commit -m "feat(snapshot): viewer falls back to page snapshot when CC unreachable"`

---

### Task 6: Snapshot notice + load-failed copy fix (READ workstream)

**Files:**
- Modify: `src/components/Viewer/GenericViewer.vue`

**Interfaces:**
- Consumes: `diagram.snapshotFallback`, `diagram.snapshotAt` (Task 5).

- [ ] **Step 1:** In `editDisabledReason` (line ~326), add before the `isCopy` branch:

```typescript
if (this.diagram.snapshotFallback) {
  const when = this.diagram.snapshotAt ? new Date(this.diagram.snapshotAt).toLocaleDateString() : '';
  return `Showing a cached copy${when ? ` from ${when}` : ''}. The original diagram is unavailable — it may have been deleted, or you may not have permission to view its source page.`;
}
```

- [ ] **Step 2:** Fix the dead permission branch: the research (drawio-copy-behaviour) proved CC 403s surface as `NOT_FOUND`, so `isPermissionError()` (httpStatus === 403) never fires. Find the generic load-failed message and amend it to mention both causes: `"Couldn't load this diagram. It may have been deleted, or you may not have permission to view its source page."` Do not remove `isPermissionError` — just fix the user-facing copy.
- [ ] **Step 3:** Extend the component's spec (`GenericViewer.spec.ts` exists) with one test: `snapshotFallback: true` → `editDisabledReason` contains "cached copy".
- [ ] **Step 4: Tests pass**; **Step 5: Commit**: `git commit -m "feat(snapshot): cached-copy notice + honest load-failed copy"`

---

## Verification (per workstream, before PR)

- `pnpm test:unit src/model/SnapshotAttachment.spec.ts` and the specs you touched — all green.
- `npx vue-tsc --noEmit 2>&1 | wc -l` — no worse than origin/main.
- Push branch, open PR to `ZenUml/conf-app` with a body summarizing tasks done + test evidence. Do NOT merge.

## Known limitations (documented, not blockers)

- New-page drafts: attachment upload to a never-published draft is unverified; if it fails, the save-path/backfill self-heals on the next editor session after publish.
- Snapshot staleness: a cross-page snapshot refreshes only on the host page's editor sessions — acceptable by design (disaster fallback, labeled with its date).
- Stock pages never edited again get no snapshot until viewed/edited (the #212 view-time PNG path's opportunistic model applies if later extended).
