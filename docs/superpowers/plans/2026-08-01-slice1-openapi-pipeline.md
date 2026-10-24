# Slice 1 — OpenAPI Document-Opening Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation subagents run on **Sonnet** (never Fable).

**Goal:** The OpenAPI viewer (`forge-swagger-ui.ts`) and editor (`forge-swagger-editor.ts`) resolve, recover, and open their document through one shared pipeline (`openDocument` + an OpenAPI `TargetSpec`), deleting both files' independent inline resolution/recovery orchestration in the same PR.

**Architecture:** New module `src/utils/documentOpening/` (`types.ts`, `openDocument.ts`, `targets/openApiTarget.ts`). `openDocument(policy, context, pageId, target)` owns: sync id resolution, the direct fetch + orphan-sibling recovery (`ApWrapper2.loadCustomContentWithOrphanRecovery`), the family's ordered legacy fallbacks, orphan telemetry, and the `OpenedDocument{doc, origin}` / `failed(OpenError)` outcome. It does **not** own paywall or SWR caching — those stay exactly where they are (`viewerBootstrap.ts`, `mountPaywallGate.ts`); Slice 4 folds them in when `viewerBootstrap.ts` itself retires. `viewerBootstrap.ts`'s `loadDiagram` / `afterLoad` contract is extended (additively — existing callers passing a plain `Diagram` are unaffected) to carry an optional `loadError`, so a total resolution failure can surface as a real terminal state in `OpenApiViewer.vue` instead of silently rendering `OpenApiExample`.

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit`), Vue 3 (`OpenApiViewer.vue`).

**Spec:** `docs/superpowers/specs/2026-07-31-content-opening-unification-design.md` (Slice 1). Supersedes PR #196 (`feat/error-panel`, draft, unmerged) — that PR's `viewerLoadOutcome.ts`/`ViewerLoadDiagramResult` contract is replaced by this slice's own `OpenError`/`loadError`, and #196 closes once this slice merges (see Task 6).

## Global Constraints

- Consistency and structural simplicity are the primary goals.
- When current code paths behave differently, choose one reasonable rule instead of preserving every historical variation with hooks and adapters.
- Small user-visible changes are acceptable if they result naturally from that simplification.
- **Do not add states, fallbacks, telemetry, recovery UI, or other code merely to make behavior "better".** Concretely: no retry button, no "contact support" / diagnostic-bundle feature, no new Mixpanel events for the terminal-error state — that was PR #196's own scope, not this slice's. A visible terminal message is the full requirement.
- Preserve only hard requirements: data integrity, authorization/paywall enforcement, essential legacy-content compatibility. The `legacyLoadBlocked` fail-closed save guard (Task 5) is one of these — it is not "polish."
- Success means fewer concepts, fewer branches, and preferably less production code.
- **Zero family branches inside the pipeline.** Every OpenAPI-specific behavior (uuid-title fallback, `isDashboardEdit` derivation, new-macro default doc) lives in `targets/openApiTarget.ts`, never as an `if` inside `openDocument.ts`.
- **Branch from current `origin/main` only.** Work in a fresh worktree:
  `git worktree add ../conf-app-slice1-openapi -b refactor/slice1-openapi-pipeline origin/main` (already created for this plan's authoring — reuse it).
- No new Mixpanel events or catalog changes. The `surface` property extension on `customcontent_orphan_observed` is Slice 3's first commit, not this one's — Task 1/2 preserve `reportOrphanObserved`'s call shape exactly as it is today (no `surface` argument).
- Typecheck baseline is red on `main` (~150 pre-existing errors) — compare error count to main, don't chase zero.

## Accepted behavior changes (approved — do not "fix" these back)

1. **OpenAPI editor, brand-new macro (no `customContentId`, no `uuid` fallback match):** `store.state.diagram` becomes `NULL_DIAGRAM` and `window.diagram` becomes `NULL_DIAGRAM` (both were previously `undefined` in this exact path — `doc` stayed `undefined` all the way through). The visible editor text is unaffected (`window.updateSpec(doc?.code || OpenApiExample)` still resolves to `OpenApiExample` either way, since `NULL_DIAGRAM.code === ''`). This is `OpenedDocument.doc: Diagram`'s whole point — never expose `undefined` from an `opened` outcome — and it also happens to fix a latent inconsistency in `exit()`'s `codeChanged` check (previously `undefined?.code !== window.specContent` was `true` at mount even before any edit).
2. **OpenAPI editor, existing macro whose `customContentId` load totally fails (data-loss guard, new):** previously silently mounted the blank `OpenApiExample` template and allowed Publish to save over it, creating a fresh custom content and stamping its id into the macro config — the exact "recovery discarded the original" failure Graph already guards against. This slice extends Graph's `legacyLoadBlocked` fail-closed save guard (`src/model/ContentProvider/Persistence.ts:41`, already generic — it checks `diagram.legacyLoadBlocked` for any family) to the OpenAPI editor: Publish now throws `LegacyLoadBlockedSaveError`, caught with the same toast Graph shows ("Legacy diagram content failed to load — saving is disabled to prevent data loss. Please refresh the page or contact support."). Editor stays open; no data is overwritten.
3. **OpenAPI viewer, total resolution failure:** previously rendered the `OpenApiExample` sample spec with no visible indication anything was wrong (silent degradation — the exact thing `viewer_load_failed`'s analytics-only signal never surfaced to the user). Now shows a plain terminal message ("This diagram isn't available.") instead. No retry button, no support link — see Global Constraints.

---

### Task 1: `openDocument` pipeline core (TDD)

**Files:**
- Create: `src/utils/documentOpening/types.ts`
- Create: `src/utils/documentOpening/openDocument.ts`
- Test: `src/utils/documentOpening/openDocument.spec.ts`

**Interfaces:**
- Produces (consumed by Task 2 and Task 3/5): `OpenPolicy`, `TargetSource`, `ResolvedTarget`, `LegacyFallbackContext`, `LegacyFallback`, `TargetSpec`, `DocumentOrigin`, `OpenedDocument`, `OpenError`, `OpenOutcome`, `OpenDocumentOptions`, and the `openDocument(opts: OpenDocumentOptions): Promise<OpenOutcome>` function.
- Consumes: `globals.apWrapper.loadCustomContentWithOrphanRecovery` (existing, `src/model/ApWrapper2.ts:764`), `reportOrphanObserved` (existing, `src/utils/orphanTelemetry.ts:31`).

- [ ] **Step 1: Write `types.ts`**

```ts
// src/utils/documentOpening/types.ts
import { Diagram } from '@/model/Diagram/Diagram';
import type { OrphanDiagramKind } from '@/utils/orphanTelemetry';

// Slice 1 of the content-opening unification
// (docs/superpowers/specs/2026-07-31-content-opening-unification-design.md).
// openDocument covers id resolution + recovery only. Paywall stays a
// caller-side gate (mountPaywallGate.ts) and SWR caching stays inside
// viewerBootstrap.ts until Slice 4 retires that file.

/** 'read' = viewer/dashboard-view (SWR-eligible, cross-page-only copy scan).
 *  'write' = editor (fresh load, full blocking copy scan). */
export type OpenPolicy = 'read' | 'write';

export type TargetSource = 'config' | 'modal';

export interface ResolvedTarget {
  contentId?: string;
  source: TargetSource;
}

export interface LegacyFallbackContext {
  context: any;
  pageId?: string;
}

/**
 * A family-specific recovery step, tried in order after the direct fetch +
 * orphan-sibling recovery both miss. Must stamp `doc.recoveredFromOrphan =
 * true` on any doc it returns and fire its own telemetry — this mirrors
 * exactly what the inline per-family code does today; it is a lift-and-shift,
 * not new behavior.
 */
export type LegacyFallback = (ctx: LegacyFallbackContext) => Promise<Diagram | undefined>;

export interface TargetSpec {
  /**
   * Sync — doubles as the SWR cache key at the caller
   * (viewerBootstrap.ts's `resolveContentId`), so it must resolve the SAME id
   * this does.
   */
  resolveId(context: any): ResolvedTarget | undefined;
  /** Ordered family-specific recovery chain, tried after the direct fetch and
   *  orphan-sibling recovery both miss. */
  legacyFallbacks: LegacyFallback[];
  /**
   * No id at all: 'default-doc' opens `defaultDoc()` (the new-macro case);
   * 'fail' returns `failed`. An id that WAS resolved but every fallback still
   * misses is ALWAYS `failed`, regardless of this setting — that is not a
   * "miss", it's a real resolution failure.
   */
  onMiss: 'default-doc' | 'fail';
  defaultDoc?: () => Diagram;
  /** `reportOrphanObserved`'s `diagramKind` argument. */
  macroType: OrphanDiagramKind;
}

export interface DocumentOrigin {
  contentId?: string;
  source?: TargetSource;
  recoveredFromOrphan: boolean;
  /**
   * The id `resolveId` returned, captured regardless of whether the load
   * needed recovery — feeds `deriveWritebackSignals`'s
   * `originalCustomContentId` (src/model/writebackGate.ts), replacing the
   * editors' module-scope `originalCustomContentId` variable.
   */
  originalCustomContentId?: string;
  /** The page the macro lives on, captured whenever `resolveId` ran — feeds
   *  `reportOrphanMacroRepaired`'s pageId argument on a later save-repair. */
  recoveryPageId?: string;
}

export interface OpenedDocument {
  doc: Diagram;
  origin: DocumentOrigin;
}

export type OpenErrorKind = 'not_found';

export interface OpenError {
  kind: OpenErrorKind;
  customContentId?: string;
}

export type OpenOutcome =
  | { kind: 'opened'; document: OpenedDocument }
  | { kind: 'failed'; error: OpenError };

export interface OpenDocumentOptions {
  policy: OpenPolicy;
  context: any;
  pageId?: string;
  target: TargetSpec;
}
```

- [ ] **Step 2: Write the failing tests** — `src/utils/documentOpening/openDocument.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDocument } from './openDocument';
import type { TargetSpec } from './types';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      loadCustomContentWithOrphanRecovery: vi.fn(),
    },
  },
}));

vi.mock('@/utils/orphanTelemetry', () => ({
  reportOrphanObserved: vi.fn(),
}));

import globals from '@/model/globals';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';

function baseTarget(overrides: Partial<TargetSpec> = {}): TargetSpec {
  return {
    resolveId: () => ({ contentId: 'cc-1', source: 'config' }),
    legacyFallbacks: [],
    onMiss: 'fail',
    macroType: 'openapi',
    ...overrides,
  };
}

describe('openDocument (Slice 1 core pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no id, onMiss=fail: returns failed without calling loadCustomContentWithOrphanRecovery', async () => {
    const target = baseTarget({ resolveId: () => undefined });
    const outcome = await openDocument({ policy: 'read', context: {}, target });
    expect(outcome).toEqual({ kind: 'failed', error: { kind: 'not_found' } });
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
  });

  it('no id, onMiss=default-doc: opens defaultDoc() with recoveredFromOrphan=false', async () => {
    const target = baseTarget({
      resolveId: () => undefined,
      onMiss: 'default-doc',
      defaultDoc: () => NULL_DIAGRAM,
    });
    const outcome = await openDocument({ policy: 'write', context: {}, target });
    expect(outcome).toEqual({
      kind: 'opened',
      document: { doc: NULL_DIAGRAM, origin: { recoveredFromOrphan: false } },
    });
  });

  it('direct fetch hit: opens with origin.originalCustomContentId set and recoveredFromOrphan=false', async () => {
    const doc = { ...NULL_DIAGRAM, code: 'openapi: 3.0.0' } as Diagram;
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: { id: 'cc-1', value: doc } as any,
    });
    const outcome = await openDocument({ policy: 'read', context: {}, pageId: 'page-1', target: baseTarget() });
    expect(outcome).toEqual({
      kind: 'opened',
      document: {
        doc,
        origin: {
          contentId: 'cc-1',
          source: 'config',
          recoveredFromOrphan: false,
          originalCustomContentId: 'cc-1',
          recoveryPageId: 'page-1',
        },
      },
    });
    expect(reportOrphanObserved).not.toHaveBeenCalled();
  });

  it('policy=read passes copyCheckMode cross-page-only; policy=write passes full', async () => {
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: { id: 'cc-1', value: { ...NULL_DIAGRAM } } as any,
    });
    await openDocument({ policy: 'read', context: {}, target: baseTarget() });
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith(
      undefined, 'cc-1', { copyCheckMode: 'cross-page-only' },
    );
    await openDocument({ policy: 'write', context: {}, target: baseTarget() });
    expect(globals.apWrapper.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith(
      undefined, 'cc-1', { copyCheckMode: 'full' },
    );
  });

  it('orphan-sibling recovery hit: stamps doc, reports recoveryUsed=true, origin.recoveredFromOrphan=true', async () => {
    const doc = { ...NULL_DIAGRAM, code: 'recovered' } as Diagram;
    const probeResult = { recoverable: true } as any;
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: { id: 'cc-2', value: doc } as any,
      recoveredFromOrphanId: 'cc-1',
      probeResult,
    });
    const outcome = await openDocument({ policy: 'read', context: {}, pageId: 'page-1', target: baseTarget() });
    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') throw new Error('unreachable');
    expect(outcome.document.doc.recoveredFromOrphan).toBe(true);
    expect(outcome.document.doc.recoveredFromOrphanId).toBe('cc-1');
    expect(outcome.document.origin.recoveredFromOrphan).toBe(true);
    expect(reportOrphanObserved).toHaveBeenCalledWith('page-1', 'cc-1', 'openapi', probeResult, {
      recoveryUsed: true,
      recoveredId: 'cc-2',
    });
  });

  it('direct + orphan both miss: reports recoveryUsed=false, then tries legacyFallbacks in order', async () => {
    const probeResult = { recoverable: false } as any;
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: undefined,
      probeResult,
    });
    const firstFallback = vi.fn(async () => undefined);
    const recovered = { ...NULL_DIAGRAM, code: 'from uuid' } as Diagram;
    const secondFallback = vi.fn(async (ctx: any) => {
      expect(ctx.pageId).toBe('page-1');
      return recovered;
    });
    const outcome = await openDocument({
      policy: 'read', context: { some: 'ctx' }, pageId: 'page-1',
      target: baseTarget({ legacyFallbacks: [firstFallback, secondFallback] }),
    });
    expect(firstFallback).toHaveBeenCalledTimes(1);
    expect(secondFallback).toHaveBeenCalledTimes(1);
    expect(reportOrphanObserved).toHaveBeenCalledWith('page-1', 'cc-1', 'openapi', probeResult, {
      recoveryUsed: false,
    });
    expect(outcome).toEqual({
      kind: 'opened',
      document: {
        doc: recovered,
        origin: {
          contentId: 'cc-1',
          source: 'config',
          recoveredFromOrphan: true,
          originalCustomContentId: 'cc-1',
          recoveryPageId: 'page-1',
        },
      },
    });
  });

  it('id resolved but every fallback exhausted: returns failed with the customContentId', async () => {
    vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
      customContent: undefined,
      probeResult: { recoverable: false } as any,
    });
    const outcome = await openDocument({
      policy: 'write', context: {}, target: baseTarget({ legacyFallbacks: [vi.fn(async () => undefined)] }),
    });
    expect(outcome).toEqual({ kind: 'failed', error: { kind: 'not_found', customContentId: 'cc-1' } });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test:unit src/utils/documentOpening/openDocument.spec.ts`
Expected: FAIL — `./openDocument` module doesn't exist yet.

- [ ] **Step 4: Implement `openDocument.ts`**

```ts
// src/utils/documentOpening/openDocument.ts
import globals from '@/model/globals';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import type { OpenDocumentOptions, OpenOutcome } from './types';

export async function openDocument(opts: OpenDocumentOptions): Promise<OpenOutcome> {
  const { policy, context, pageId, target } = opts;
  const resolved = target.resolveId(context);

  if (!resolved?.contentId) {
    if (target.onMiss === 'default-doc') {
      return {
        kind: 'opened',
        document: { doc: target.defaultDoc!(), origin: { recoveredFromOrphan: false } },
      };
    }
    return { kind: 'failed', error: { kind: 'not_found' } };
  }

  const { contentId, source } = resolved;
  const copyCheckMode = policy === 'read' ? 'cross-page-only' : 'full';
  const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
    pageId, contentId, { copyCheckMode },
  );

  let doc = loaded.customContent?.value;
  let recoveredFromOrphan = false;

  if (loaded.recoveredFromOrphanId && doc) {
    doc.recoveredFromOrphan = true;
    doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
    recoveredFromOrphan = true;
    reportOrphanObserved(pageId, contentId, target.macroType, loaded.probeResult, {
      recoveryUsed: true,
      recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
    });
  } else if (!doc) {
    reportOrphanObserved(pageId, contentId, target.macroType, loaded.probeResult, {
      recoveryUsed: false,
    });
    for (const fallback of target.legacyFallbacks) {
      doc = await fallback({ context, pageId });
      if (doc) {
        recoveredFromOrphan = true;
        break;
      }
    }
  }

  if (!doc) {
    return { kind: 'failed', error: { kind: 'not_found', customContentId: contentId } };
  }

  return {
    kind: 'opened',
    document: {
      doc,
      origin: {
        contentId,
        source,
        recoveredFromOrphan,
        originalCustomContentId: contentId,
        recoveryPageId: pageId,
      },
    },
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:unit src/utils/documentOpening/openDocument.spec.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/documentOpening/types.ts src/utils/documentOpening/openDocument.ts src/utils/documentOpening/openDocument.spec.ts
git commit -m "feat(documentOpening): add the openDocument pipeline core (slice 1)"
```

---

### Task 2: OpenAPI `TargetSpec` (TDD)

**Files:**
- Create: `src/utils/documentOpening/targets/openApiTarget.ts`
- Test: `src/utils/documentOpening/targets/openApiTarget.spec.ts`

**Interfaces:**
- Consumes: `TargetSpec`, `LegacyFallback`, `ResolvedTarget` (Task 1). `globals.apWrapper.findLegacyCustomContentByUuid` (existing, `src/model/ApWrapper2.ts:847`). `trackEvent` (`@/utils/window`).
- Produces: `buildOpenApiViewerTarget(): TargetSpec`, `buildOpenApiEditorTarget(): TargetSpec`. Task 3 calls the first; Task 5 calls the second.

- [ ] **Step 1: Write the failing tests** — `src/utils/documentOpening/targets/openApiTarget.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOpenApiViewerTarget, buildOpenApiEditorTarget } from './openApiTarget';
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { findLegacyCustomContentByUuid: vi.fn() } },
}));
vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }));

import globals from '@/model/globals';
import { trackEvent } from '@/utils/window';

describe('openApiTarget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('viewer target resolves from config first, falls back to modal, tags source', () => {
    const target = buildOpenApiViewerTarget();
    expect(target.resolveId({ extension: { config: { customContentId: 'cc-config' } } }))
      .toEqual({ contentId: 'cc-config', source: 'config' });
    expect(target.resolveId({ extension: { modal: { customContentId: 'cc-modal' } } }))
      .toEqual({ contentId: 'cc-modal', source: 'modal' });
    expect(target.resolveId({ extension: {} })).toBeUndefined();
  });

  it('viewer target: onMiss=fail, no defaultDoc', () => {
    const target = buildOpenApiViewerTarget();
    expect(target.onMiss).toBe('fail');
    expect(target.defaultDoc).toBeUndefined();
  });

  it('editor target: onMiss=default-doc resolves to NULL_DIAGRAM', () => {
    const target = buildOpenApiEditorTarget();
    expect(target.onMiss).toBe('default-doc');
    expect(target.defaultDoc!()).toBe(NULL_DIAGRAM);
  });

  it('both targets tag macroType openapi', () => {
    expect(buildOpenApiViewerTarget().macroType).toBe('openapi');
    expect(buildOpenApiEditorTarget().macroType).toBe('openapi');
  });

  it('uuid-title fallback: no config.uuid -> undefined, no API call', async () => {
    const target = buildOpenApiViewerTarget();
    const doc = await target.legacyFallbacks[0]({ context: { extension: { config: {} } } });
    expect(doc).toBeUndefined();
    expect(globals.apWrapper.findLegacyCustomContentByUuid).not.toHaveBeenCalled();
  });

  it('uuid-title fallback: recovery hit stamps recoveredFromOrphan and fires the viewer-tagged event', async () => {
    const recoveredDoc = { ...NULL_DIAGRAM, code: 'from uuid', isCopy: true };
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue({
      id: 'cc-recovered', value: recoveredDoc,
    } as any);
    const target = buildOpenApiViewerTarget();
    const doc = await target.legacyFallbacks[0]({
      context: { extension: { config: { uuid: 'uuid-1' } } }, pageId: 'page-1',
    });
    expect(doc).toBe(recoveredDoc);
    expect(doc!.recoveredFromOrphan).toBe(true);
    expect(trackEvent).toHaveBeenCalledWith('uuid-1', 'legacy_custom_content_by_uuid_restored', 'info', {
      surface: 'viewer',
      macro_type: 'openapi',
      recovered_id: 'cc-recovered',
      is_copy: 'true',
      page_id: 'page-1',
    });
  });

  it('uuid-title fallback: editor target tags surface editor', async () => {
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue({
      id: 'cc-recovered', value: { ...NULL_DIAGRAM, isCopy: false },
    } as any);
    const target = buildOpenApiEditorTarget();
    await target.legacyFallbacks[0]({ context: { extension: { config: { uuid: 'uuid-1' } } } });
    expect(trackEvent).toHaveBeenCalledWith('uuid-1', 'legacy_custom_content_by_uuid_restored', 'info',
      expect.objectContaining({ surface: 'editor' }));
  });

  it('uuid-title fallback: no recovery match returns undefined', async () => {
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue(undefined);
    const target = buildOpenApiViewerTarget();
    const doc = await target.legacyFallbacks[0]({ context: { extension: { config: { uuid: 'uuid-1' } } } });
    expect(doc).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit src/utils/documentOpening/targets/openApiTarget.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/utils/documentOpening/targets/openApiTarget.ts
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackEvent } from '@/utils/window';
import globals from '@/model/globals';
import type { LegacyFallback, ResolvedTarget, TargetSpec } from '@/utils/documentOpening/types';

function resolveOpenApiId(context: any): ResolvedTarget | undefined {
  const configId = context.extension?.config?.customContentId;
  const modalId = context.extension?.modal?.customContentId;
  const contentId = configId || modalId;
  if (!contentId) return undefined;
  return { contentId, source: configId ? 'config' : 'modal' };
}

/**
 * ZEN-1170 Defect 1 sibling: cross-page-paste recovery via uuid -> CC title
 * (findLegacyCustomContentByUuid). OpenAPI macros never used content
 * properties, so this is the family's only legacy fallback.
 */
function makeUuidTitleFallback(surface: 'viewer' | 'editor'): LegacyFallback {
  return async ({ context, pageId }) => {
    const storageUuid = context.extension?.config?.uuid;
    if (!storageUuid) return undefined;
    const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
    if (!recovered?.value) return undefined;
    const doc = recovered.value;
    doc.recoveredFromOrphan = true;
    trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
      surface,
      macro_type: 'openapi',
      recovered_id: String(recovered.id ?? ''),
      is_copy: doc.isCopy ? 'true' : 'false',
      ...(pageId && { page_id: pageId }),
    });
    return doc;
  };
}

export function buildOpenApiViewerTarget(): TargetSpec {
  return {
    resolveId: resolveOpenApiId,
    legacyFallbacks: [makeUuidTitleFallback('viewer')],
    onMiss: 'fail',
    macroType: 'openapi',
  };
}

export function buildOpenApiEditorTarget(): TargetSpec {
  return {
    resolveId: resolveOpenApiId,
    legacyFallbacks: [makeUuidTitleFallback('editor')],
    onMiss: 'default-doc',
    defaultDoc: () => NULL_DIAGRAM,
    macroType: 'openapi',
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:unit src/utils/documentOpening/targets/openApiTarget.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/documentOpening/targets/openApiTarget.ts src/utils/documentOpening/targets/openApiTarget.spec.ts
git commit -m "feat(documentOpening): OpenAPI TargetSpec — viewer + editor"
```

---

### Task 3: Migrate `forge-swagger-ui.ts` (viewer, read policy) onto the pipeline

**Files:**
- Modify: `src/forge-swagger-ui.ts` (deletes the entire current `loadDiagram` body, `src/forge-swagger-ui.ts:15-73`)
- Modify: `src/utils/viewerBootstrap.ts` (extend `ViewerBootstrapOptions.loadDiagram`'s return type and `afterLoad`'s signature; thread `loadError` through `publishLoadedDiagram`)
- Test: `src/utils/viewerBootstrap.spec.ts` (extend)

**Interfaces:**
- Consumes: `openDocument`, `buildOpenApiViewerTarget` (Tasks 1–2). `initForgeContext` (existing).
- Produces: `ViewerBootstrapOptions.loadDiagram: () => Promise<Diagram | undefined | { doc?: Diagram; loadError?: OpenError | null }>`; `publishLoadedDiagram(doc: Diagram | undefined, loadError?: OpenError | null): Diagram` (extended signature — the 2nd param is new and optional, so every existing call site with one argument is unaffected).

**No new `forge-swagger-ui.spec.ts`.** No `forge-*-ui.ts`/`forge-*-editor.ts` entry file in this repo has a unit-test harness today (`ls src/forge-*.spec.ts` returns nothing) — they are side-effecting modules that run `void initializeMacro()` at import time with no exported test seam, and inventing a harness for just this one file would be a parallel test style, not a fix. After Step 6's rewrite, `loadDiagram` is a ~12-line composition of `openDocument` + `buildOpenApiViewerTarget`, both already fully unit-tested (Tasks 1–2); entry-file-level coverage comes from the EXISTING Playwright specs `tests/e2e-tests/tests/render/openapi.spec.ts`, `tests/e2e-tests/tests/insert/openapi.spec.ts`, and `tests/e2e-tests/tests/fullscreen/openapi-create.spec.ts` / `openapi-edit.spec.ts` (project `fullscreen`, `insert`, `render` — see `tests/e2e-tests/playwright.config.ts`), which Task 6 Step 1's `/validate-branch` and Step 3's spot check both run.

- [ ] **Step 1: Write the failing test in `viewerBootstrap.spec.ts`** — append to the existing `describe('viewerBootstrap', ...)` block (the file already mocks `@/model/globals`, `@/mount-root`, `@/utils/paywall/mountPaywallGate` — reuse those):

```ts
  it('accepts a { doc, loadError } loadDiagram result and publishes the doc with loadError attached', async () => {
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi };
    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({ doc: loaded, loadError: null })),
    });
    expect(store.state.diagram).toStrictEqual(loaded);
  });

  it('a failed load ({ doc: undefined, loadError }) publishes NULL_DIAGRAM with loadError attached', async () => {
    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({ doc: undefined, loadError: { kind: 'not_found' as const } })),
    });
    expect(store.state.diagram).toEqual({ ...NULL_DIAGRAM, loadError: { kind: 'not_found' } });
    expect(store.state.diagramLoadComplete).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit src/utils/viewerBootstrap.spec.ts`
Expected: FAIL — `store.state.diagram` has no `loadError` (the plain-`Diagram` result path is taken, so the wrapped shape gets published as-is via `{...}` spread, not normalized).

- [ ] **Step 3: Implement — extend `viewerBootstrap.ts`**

Add the import and types at the top of `src/utils/viewerBootstrap.ts`:

```ts
import type { OpenError } from '@/utils/documentOpening/types';
```

Change `ViewerBootstrapOptions`:

```ts
export type ViewerLoadDiagramResult = Diagram | undefined | { doc?: Diagram; loadError?: OpenError | null };

export interface ViewerBootstrapOptions {
  macroKind: MacroKind;
  content: Component;
  contentProps?: Record<string, unknown>;
  loadDiagram: () => Promise<ViewerLoadDiagramResult>;
  afterLoad?: (doc: Diagram | undefined) => void | Promise<void>;
  onError?: (error: unknown) => void;
  resolveContentId?: (context: any) => string | undefined;
}
```

Add a normalizer right after `normalizeCompressedGraphDoc` and change `publishLoadedDiagram`:

```ts
function normalizeViewerLoadResult(
  result: ViewerLoadDiagramResult,
): { doc: Diagram | undefined; loadError: OpenError | null } {
  if (result && typeof result === 'object' && 'doc' in result) {
    return { doc: result.doc, loadError: result.loadError ?? null };
  }
  return { doc: result as Diagram | undefined, loadError: null };
}

export function publishLoadedDiagram(doc: Diagram | undefined, loadError?: OpenError | null): Diagram {
  const normalized = normalizeCompressedGraphDoc(doc) ?? NULL_DIAGRAM;
  const diagram = loadError ? { ...normalized, loadError } : normalized;
  store.state.diagram = diagram;
  store.state.diagramLoadComplete = true;
  window.diagram = diagram;
  console.log('loadDiagram - window.diagram', window.diagram);
  return diagram;
}
```

Update the two call sites inside `bootstrapForgeViewer` and `revalidateViewer` that call `options.loadDiagram()` — each currently does `const doc = await renderPerf.time('fetch', () => options.loadDiagram()); publishLoadedDiagram(doc);`. Replace with:

```ts
    const result = normalizeViewerLoadResult(await renderPerf.time('fetch', () => options.loadDiagram()));
    publishLoadedDiagram(result.doc, result.loadError);
```

(and the matching change in `revalidateViewer`, where `const fresh = await renderPerf.time('fetch', () => options.loadDiagram()); if (!fresh) return;` becomes:

```ts
    const result = normalizeViewerLoadResult(await renderPerf.time('fetch', () => options.loadDiagram()));
    if (!result.doc) return;
    const fresh = result.doc;
```

— keep the rest of `revalidateViewer` byte-identical, it already only reads `fresh` from that point on).

The content-SWR cache-hit branch (`const cachedDoc = JSON.parse(cached.doc) as Diagram; ... publishLoadedDiagram(cachedDoc);`) is unaffected — cached docs never carry a `loadError` (a failed load is never cached; see `if (customContentId && doc)` below the fetch call, unchanged).

Add the `loadError` field to the `Diagram` class (`src/model/Diagram/Diagram.ts`), directly under the existing `snapshotFallback`/`snapshotAt` fields, matching their exact doc-comment convention:

```ts
  // Slice 1 of the content-opening unification: set when openDocument's
  // resolution totally failed (an id existed but every direct fetch, orphan
  // recovery, and legacy fallback missed). OpenApiViewer.vue (and later
  // families as they migrate) render a terminal message instead of silently
  // falling back to an example/blank document.
  loadError?: { kind: 'not_found'; customContentId?: string } = undefined;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:unit src/utils/viewerBootstrap.spec.ts`
Expected: PASS — the 2 new tests plus every pre-existing test in the file (they all pass a plain `Diagram`, which `normalizeViewerLoadResult` returns unchanged via its `else` branch — zero behavior change for graph/embed).

- [ ] **Step 5: Rewrite `forge-swagger-ui.ts`'s `loadDiagram`**

Delete the entire current `loadDiagram` function body (lines 15–73) and its `reportOrphanObserved` import (no longer used directly here — it moves into `openDocument`/the target). Replace with:

```ts
import "swagger-ui/dist/swagger-ui.css";
import './assets/tailwind.css'

import createAttachmentIfContentChanged from "@/model/Attachment";
import {trackEvent, serializeError} from "@/utils/window";
import globals from '@/model/globals';
import OpenApiViewer from "@/components/Viewer/OpenApiViewer.vue";
import EventBus from './EventBus'
import { getContext as initForgeContext, openModal } from './model/globals/forgeGlobal';
import { bootstrapForgeViewer, type ViewerLoadDiagramResult } from '@/utils/viewerBootstrap';
import { openDocument } from '@/utils/documentOpening/openDocument';
import { buildOpenApiViewerTarget } from '@/utils/documentOpening/targets/openApiTarget';
import { guardEditClick } from '@/utils/guardEditClick';

async function loadDiagram(): Promise<ViewerLoadDiagramResult> {
  const context = await initForgeContext();
  const pageId = context.extension?.content?.id;
  const outcome = await openDocument({
    policy: 'read',
    context,
    pageId,
    target: buildOpenApiViewerTarget(),
  });
  if (outcome.kind === 'failed') {
    return { doc: undefined, loadError: outcome.error };
  }
  return { doc: outcome.document.doc, loadError: null };
}
```

(`Diagram` import is dropped — no longer referenced directly in this file. `afterLoad`, `initializeMacro`, and the `EventBus.$on('edit', ...)` block below stay byte-identical — `resolveContentId` still reads `context.extension?.config?.customContentId || context.extension?.modal?.customContentId`, the same id `buildOpenApiViewerTarget().resolveId` resolves, so the SWR cache key is unchanged.)

- [ ] **Step 6: Verify** — `pnpm test:unit` green; `npx vue-tsc --noEmit 2>&1 | grep -c 'error TS'` no worse than main's baseline; `npx vue-tsc --noEmit 2>&1 | grep 'forge-swagger-ui\|viewerBootstrap'` shows no NEW errors.

- [ ] **Step 7: Commit**

```bash
git add src/forge-swagger-ui.ts src/utils/viewerBootstrap.ts src/utils/viewerBootstrap.spec.ts src/model/Diagram/Diagram.ts
git commit -m "refactor(openapi): migrate the viewer onto the documentOpening pipeline"
```

---

### Task 4: `OpenApiViewer.vue` terminal-error state

**Files:**
- Modify: `src/components/Viewer/OpenApiViewer.vue`
- Test: `src/components/Viewer/OpenApiViewer.spec.ts` (check whether it exists first; extend or create matching its style)

**Interfaces:**
- Consumes: `Diagram.loadError` (Task 3).
- Produces: no new exports — a template/computed change only.

- [ ] **Step 1: Check for an existing spec file**

Run: `ls src/components/Viewer/OpenApiViewer.spec.ts 2>/dev/null || echo "none"`.

- [ ] **Step 2: Write the failing test** (append to the existing spec, or create one following the pattern of a sibling viewer's spec — e.g. `ForgeEmbedViewer.spec.ts` — for mount/store setup conventions used in this repo):

```ts
it('shows a terminal message instead of the example spec when loadError is set', async () => {
  const wrapper = mount(OpenApiViewer, {
    global: { plugins: [store] },
  });
  store.state.diagram = { ...NULL_DIAGRAM, loadError: { kind: 'not_found' } };
  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("This diagram isn't available");
  expect(wrapper.find('#swagger-ui').exists()).toBe(false);
});

it('renders the swagger UI normally when loadError is absent', async () => {
  const wrapper = mount(OpenApiViewer, {
    global: { plugins: [store] },
  });
  store.state.diagram = { ...NULL_DIAGRAM, code: 'openapi: 3.0.0' };
  await wrapper.vm.$nextTick();
  expect(wrapper.find('#swagger-ui').exists()).toBe(true);
});
```

(Adapt the mount setup — `global.plugins`, any required mocks for `SwaggerUIBundle`/`trackRenderTime` — to match whatever the existing viewer spec conventions in this repo already establish; do not invent a parallel mounting style.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test:unit src/components/Viewer/OpenApiViewer.spec.ts`
Expected: FAIL — no terminal message renders today.

- [ ] **Step 4: Implement** — modify `src/components/Viewer/OpenApiViewer.vue`'s template and script:

```html
<template>
<generic-viewer :wide="true" :hideHeader="hideHeader">
  <div v-if="loadError" class="openapi-load-error" role="status">
    This diagram isn't available.
  </div>
  <div v-else id="swagger-ui" ref="swaggerUi"></div>
</generic-viewer>
</template>
```

Add a `loadError` computed property next to `effectiveDoc`:

```js
    loadError() {
      return this.effectiveDoc?.loadError ?? null;
    },
```

Guard `initSwaggerUi`/`updateSpecFromDiagram` so they no-op when there's nothing to mount — in `mounted()`:

```js
  mounted() {
    if (!this.loadError) {
      this.initSwaggerUi();
      this.updateSpecFromDiagram();
    }
    this.reportRenderOnce();
  },
```

and guard the `doc`/`storeDiagram` watcher the same way (skip `initSwaggerUi`/`updateSpecFromDiagram` when `this.loadError` is set — `reportRenderOnce()` still runs so `macro_viewed` still fires, matching Global Constraint "readership metric, must not become success-only").

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:unit src/components/Viewer/OpenApiViewer.spec.ts`
Expected: PASS.

- [ ] **Step 6: Verify no regression on the happy path** — run the full component spec file plus `pnpm test:unit` for the whole suite.

- [ ] **Step 7: Commit**

```bash
git add src/components/Viewer/OpenApiViewer.vue src/components/Viewer/OpenApiViewer.spec.ts
git commit -m "fix(openapi): show a terminal message instead of silently rendering the example spec on load failure"
```

---

### Task 5: Migrate `forge-swagger-editor.ts` (editor, write policy) onto the pipeline

**Files:**
- Modify: `src/forge-swagger-editor.ts` (deletes the resolution block inside `mountEditorDocument`, `src/forge-swagger-editor.ts:334-374`, and the module-scope `originalCustomContentId`/`recoveryPageId` capture at line 314-315; replaces the `saveOpenApiAndExit` `derivationInput` construction)

**Interfaces:**
- Consumes: `openDocument`, `buildOpenApiEditorTarget` (Tasks 1–2), `LegacyLoadBlockedSaveError` (existing, `@/model/ContentProvider/Persistence`).
- Produces: no new exports. `saveOpenApiAndExit`'s `derivationInput` now reads `originalCustomContentId`/`docSource`/`recoveredFromOrphan` off the `OpenedDocument.origin` captured at mount time (via closure) instead of the old module-scope variables — Task-1's `deriveWritebackSignals` (Slice 0, already on `main`) is untouched.

**No new `forge-swagger-editor.spec.ts`.** Same reasoning as Task 3: no `forge-*-editor.ts` in this repo has a unit-test harness (confirmed: `ls src/forge-*.spec.ts` returns nothing), and it's a side-effecting module with no exported test seam (`void initializeMacro()` runs at import time) — building one just for this file would be a parallel, one-off test style.

**This is still the highest-blast-radius task in the slice** — a wrong `origin` field changes what gets written back to the macro on save. Coverage for that mapping comes from three places instead of a new unit-test file: (a) Task 1's `openDocument.spec.ts`, which already proves `origin.originalCustomContentId`/`origin.recoveredFromOrphan` are set correctly for every resolution path; (b) Slice 0's existing `src/model/writebackGate.spec.ts`, which already proves `deriveWritebackSignals` handles those fields correctly once supplied; and (c) Step 4 below, a mandatory line-by-line cross-check between the old and new `derivationInput` construction, written into the PR description verbatim — not skippable, and not satisfied by "tests pass."

- [ ] **Step 1: Run to verify current state** — `pnpm test:unit` (establish the green baseline before touching the editor).

- [ ] **Step 2: Implement — rewrite `mountEditorDocument`'s resolution block**

In `src/forge-swagger-editor.ts`, add the imports:

```ts
import { openDocument } from '@/utils/documentOpening/openDocument';
import { buildOpenApiEditorTarget } from '@/utils/documentOpening/targets/openApiTarget';
import { saveToPlatform, LegacyLoadBlockedSaveError } from "@/model/ContentProvider/Persistence";
```

(`saveToPlatform` is already imported — extend that existing import line with `LegacyLoadBlockedSaveError` rather than duplicating it.)

Delete the module-scope `let originalCustomContentId: string | undefined;` and `let recoveryPageId: string | undefined;` declarations (lines 48–49) — replace with:

```ts
// Captured from OpenedDocument.origin once mountEditorDocument's
// openDocument() call resolves (Slice 1 of the content-opening
// unification) — replaces the old module-scope originalCustomContentId /
// recoveryPageId variables the save handler used to read directly.
let capturedOrigin: { originalCustomContentId?: string; recoveryPageId?: string; recoveredFromOrphan: boolean } =
  { recoveredFromOrphan: false };
```

Delete lines 314–315 (`originalCustomContentId = customContentId; recoveryPageId = context.extension?.content?.id;`) — the `isDashboardEdit` derivation directly above stays (`isDashboardEdit = !configContentId && !!modalContentId;` — unrelated to `openDocument`, still computed from the raw context exactly as today, since it must be known before `mountEditorDocument` async-resolves anything).

Delete the entire resolution block inside `mountEditorDocument` (`src/forge-swagger-editor.ts:334-374` — from `let doc: Diagram | undefined;` through the closing brace of the `uuid`-fallback `if (!doc) { ... }` block) and replace with:

```ts
    const outcome = await openDocument({
      policy: 'write',
      context,
      pageId: recoveryPageId,
      target: buildOpenApiEditorTarget(),
    });

    let doc: Diagram | undefined;
    if (outcome.kind === 'opened') {
      doc = outcome.document.doc;
      capturedOrigin = {
        originalCustomContentId: outcome.document.origin.originalCustomContentId,
        recoveryPageId: outcome.document.origin.recoveryPageId,
        recoveredFromOrphan: outcome.document.origin.recoveredFromOrphan,
      };
    } else {
      // An id existed but every direct fetch, orphan recovery, and legacy
      // fallback missed. Data-integrity guard (accepted behavior change #2):
      // mount NULL_DIAGRAM with legacyLoadBlocked set so saveToPlatform
      // refuses to persist over it (src/model/ContentProvider/Persistence.ts:41),
      // instead of silently letting Publish overwrite the real document with
      // a blank OpenApiExample template.
      doc = { ...NULL_DIAGRAM, legacyLoadBlocked: true };
      capturedOrigin = { recoveredFromOrphan: false };
    }
```

(`recoveryPageId` here is the local `const recoveryPageId = context.extension?.content?.id;` already computed earlier in `initializeMacro` — unchanged, still passed through as `openDocument`'s `pageId` argument.)

Update `saveOpenApiAndExit`'s `derivationInput` construction (the block right after `const sourceId = ...`):

```ts
  const derivationInput = {
    sourceId,
    newId: id,
    originalCustomContentId: capturedOrigin.originalCustomContentId,
    // @ts-ignore
    docSource: window.diagram?.source,
    recoveredFromOrphan: capturedOrigin.recoveredFromOrphan,
  };
```

(Everything else in `saveOpenApiAndExit` — `decideWriteback(deriveWritebackSignals(...))`, the `reportOrphanMacroRepaired(recoveryPageId, ...)` call which now reads `capturedOrigin.recoveryPageId` in place of the old module var — stays byte-identical; only the two variable names it reads from change.)

Add the `LegacyLoadBlockedSaveError` catch to `saveOpenApiAndExit`'s existing `try { id = await saveToPlatform(...) } catch (error) { ... }` block, mirroring Graph's exact handling (`src/forge-graph-editor.ts:86-96`) — insert as the FIRST check inside the `catch`:

```ts
  } catch (error) {
    if (error instanceof LegacyLoadBlockedSaveError) {
      toast({
        message: 'Legacy diagram content failed to load — saving is disabled to prevent data loss. Please refresh the page or contact support.',
        duration: 8000,
      });
      EventBus.$emit('save-error', error);
      return;
    }
    console.error('saveOpenApiAndExit failed', error);
    // ...existing trackEvent/toast/return, unchanged
```

- [ ] **Step 3: Cross-check** (mandatory — this is the task's actual regression gate; write it into the PR description verbatim) — read the rewritten `mountEditorDocument` and `saveOpenApiAndExit` side by side against the OLD file (`git diff`) and confirm every field in `derivationInput` traces to an equivalent OLD source:
  - `sourceId`: unchanged (`window.diagram?.id` before save).
  - `originalCustomContentId`: OLD = module var set unconditionally to `customContentId` (the resolved id) at editor-open. NEW = `outcome.document.origin.originalCustomContentId`, which `openDocument` sets to the SAME resolved `contentId` unconditionally (Task 1, Step 4). Equivalent.
  - `docSource`: unchanged (`window.diagram?.source`).
  - `recoveredFromOrphan`: OLD = `window.diagram?.recoveredFromOrphan` (stamped on the doc itself by the recovery code). NEW = `capturedOrigin.recoveredFromOrphan`, set from `outcome.document.origin.recoveredFromOrphan`, which `openDocument` sets under the exact same conditions (orphan-sibling hit OR a legacy fallback hit) the old inline code stamped `doc.recoveredFromOrphan = true`. Equivalent — and `window.diagram.recoveredFromOrphan` is STILL set the same way too, since the doc objects `openDocument`/the fallbacks return already carry that flag (Task 1/2), so `GenericViewer.vue`'s `recoveredFromOrphan` chip/banner rendering (which reads `diagram.recoveredFromOrphan`, unrelated to this editor file) is unaffected.

- [ ] **Step 4: Verify** — `pnpm test:unit` green; `npx vue-tsc --noEmit 2>&1 | grep forge-swagger-editor` shows no NEW errors vs main.

- [ ] **Step 5: E2E regression check** — run `tests/e2e-tests/tests/fullscreen/writeback-gate-non-submittable.spec.ts`, `tests/e2e-tests/tests/fullscreen/openapi-create.spec.ts`, and `tests/e2e-tests/tests/fullscreen/openapi-edit.spec.ts` (project `fullscreen` — `tests/e2e-tests/playwright.config.ts:75`) and confirm all three stay green: `npx playwright test tests/e2e-tests/tests/fullscreen/writeback-gate-non-submittable.spec.ts tests/e2e-tests/tests/fullscreen/openapi-create.spec.ts tests/e2e-tests/tests/fullscreen/openapi-edit.spec.ts --project=fullscreen`.

- [ ] **Step 6: Commit**

```bash
git add src/forge-swagger-editor.ts src/forge-swagger-editor.spec.ts
git commit -m "refactor(openapi): migrate the editor onto the documentOpening pipeline; extend the legacyLoadBlocked save guard to swagger"
```

---

### Task 6: Validate, ship, and close the superseded PR

**Files:** none new.

- [ ] **Step 1:** Run `/validate-branch` — unit tests, lint, typecheck-vs-main, build (both `build:lite` and any variant that bundles OpenAPI — check `package.json`).

- [ ] **Step 2:** Ship via `/ship-branch` — PR against `main`, title referencing "Slice 1 of the content-opening unification", CI green (the authoritative `pull_request` run).

- [ ] **Step 3:** Staging spot check (delivery gate: "each slice gets a staging spot check that must assert `surface`/`isDisplayMode` tagging on `macro_viewed`" — the #423 regression class, issues #368/#369):
  - Create an OpenAPI macro on a staging test page, verify it renders (viewer, then in-viewer Edit modal, then page-editor Edit).
  - Confirm `macro_viewed` still tags `surface: 'viewer'` correctly for the OpenAPI viewer (Mixpanel, or console-log the event in a dev build) — this is the regression this task's Task 3/4 changes must NOT touch (they don't call `trackRenderTime` at all), but the spot check is the gate's own requirement regardless.
  - Force a load failure (temporarily break the customContentId, or use a page with a genuinely orphaned OpenAPI macro if one exists in the test space) and confirm the terminal message renders instead of the example spec (Task 4).
  - Confirm a same-page-duplicate / cross-page-copy OpenAPI edit still behaves per Slice 0's writeback gate (no regression — Task 5 doesn't touch `decideWriteback`, only what feeds it).

- [ ] **Step 4:** After Slice 1 merges, close PR #196 with a comment naming this slice's PR as the superseding work (its `viewerLoadOutcome.ts`/`ViewerLoadDiagramResult` contract is now covered by `src/utils/documentOpening/types.ts`'s `OpenError`/`loadError`, scoped down per this plan's Global Constraints — no retry/support-link UI). Do not merge #196.

## Ledger impact (spec acceptance table)

- Content-opening implementations for OpenAPI: 2 (viewer `loadDiagram` + editor `mountEditorDocument`'s resolution block) → 1 pipeline call + 1 `TargetSpec`.
- Copy-scan modes: ad hoc (`'cross-page-only'` hardcoded in the viewer, unset/full in the editor) → policy-derived inside `openDocument`.
- Fail-closed save protection: 1 family (Graph) → 2 (Graph, OpenAPI).
- Whole-file deletions: none yet (`viewerBootstrap.ts` retains its 3 remaining callers — graph, embed, and OpenAPI's viewer still calls through it for paywall+SWR — its retirement is Slice 4's).
- Zero family branches inside `openDocument.ts` — every OpenAPI-specific rule (uuid fallback, `onMiss`, `defaultDoc`) lives in `targets/openApiTarget.ts`.
