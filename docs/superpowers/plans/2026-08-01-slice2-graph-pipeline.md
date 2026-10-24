# Slice 2 — Graph Document-Opening Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation subagents run on **Sonnet** (never Fable).

**Goal:** The Graph viewer (`forge-graph-viewer.ts`) and editor (`forge-graph-editor.ts`) resolve, recover, and open their document through the shared `openDocument` pipeline + a Graph `TargetSpec`, deleting both files' independent inline resolution/recovery orchestration in the same PR — and widening the Slice 1 contracts so Graph's indeterminate `legacyLoadBlocked` fail-closed path (and the OpenAPI editor's call-site synthesis) live inside the pipeline as read-vs-write policy.

**Architecture:** Extend `src/utils/documentOpening/` — widen `LegacyFallback` so a step can return `found` / `miss` / `indeterminate`; extend `DocumentOrigin` with `legacyLoadBlocked` / `isCopy` / `copyReason`; under `policy: 'write'` + `onMiss: 'default-doc'`, `openDocument` synthesizes the default doc + fail-closed origin itself (collapsing the 30-line 3-branch block currently in `forge-swagger-editor.ts`). New `targets/graphTarget.ts` owns Graph's id resolution, content-property fallback, uuid-title fallback, and `EMPTY_GRAPH` default. Viewer/editor entry files shrink to a single `openDocument` call; `ForgeGraphViewer.vue` gains the same terminal-error surface Slice 1 gave OpenAPI. Paywall and SWR stay in `viewerBootstrap.ts` / `mountPaywallGate.ts` until Slice 4.

**Tech Stack:** TypeScript, Vitest (`pnpm test:unit`), Vue 3 (`ForgeGraphViewer.vue`).

**Spec:** `docs/superpowers/specs/2026-07-31-content-opening-unification-design.md` (Slice 2). Carry-overs from Slice 1 final review (`.superpowers/sdd/2026-08-01-slice1-openapi-pipeline/progress.md`): (1) widen `LegacyFallback`; (2) collapse fail-closed synthesis into the pipeline via `DocumentOrigin.legacyLoadBlocked`.

**Prerequisite:** Slice 1 PR [#438](https://github.com/ZenUml/conf-app/pull/438) merged to `main`. Close superseded draft PR [#196](https://github.com/ZenUml/conf-app/pull/196) when merging #438 (Slice 1 Task 6 remainder).

## Global Constraints

- Consistency and structural simplicity are the primary goals.
- When current code paths behave differently, choose one reasonable rule instead of preserving every historical variation with hooks and adapters.
- Small user-visible changes are acceptable if they result naturally from that simplification.
- **Do not add states, fallbacks, telemetry, recovery UI, or other code merely to make behavior "better".** Concretely: no retry button, no support-link UI, no new Mixpanel catalog events. Reuse the existing legacy-content-property / uuid-restored `trackEvent` calls the Graph fallbacks already fire — lift-and-shift, same shapes.
- Preserve only hard requirements: data integrity, authorization/paywall enforcement, essential legacy-content compatibility. Graph's `legacyLoadBlocked` fail-closed save guard is one of these — it is not "polish."
- Success means fewer concepts, fewer branches, and preferably less production code.
- **Zero family branches inside `openDocument.ts`.** Every Graph-specific behavior (content-property key, decompression inside that fallback, uuid-title fallback, `EMPTY_GRAPH` default, `isNew` stamping) lives in `targets/graphTarget.ts`, never as an `if (macroType === 'graph')` inside the pipeline.
- **Branch from current `origin/main` only, after #438 merges.** Work in a fresh worktree:
  `git worktree add ../conf-app-slice2-graph -b refactor/slice2-graph-pipeline origin/main`
- No new Mixpanel catalog entries. The `surface` property extension on `customcontent_orphan_observed` remains Slice 3's first commit.
- Typecheck baseline is red on `main` — compare error count to main, don't chase zero.
- Do **not** migrate Embed or Sequence in this slice.

## Accepted behavior changes (approved — do not "fix" these back)

1. **Graph viewer, total resolution failure:** previously rendered an empty DrawIO canvas with no indication anything was wrong. Now shows the same plain terminal message OpenAPI uses ("This diagram isn't available.") via `Diagram.loadError`. No retry button, no support link.
2. **OpenAPI editor call site simplifies:** after Task 1, `policy: 'write'` + `onMiss: 'default-doc'` always returns `kind: 'opened'` (with `origin.legacyLoadBlocked` / `doc.legacyLoadBlocked` set when the failure was indeterminate). The 3-branch `opened` / `failed.indeterminate` / `failed.confirmed` synthesis in `forge-swagger-editor.ts` collapses to one `opened` path. Confirmed-absent self-heal still works — `origin.originalCustomContentId` is set so `deriveWritebackSignals` can repoint the macro; indeterminate still refuses save via `legacyLoadBlocked`.
3. **`LegacyFallback` return type changes from `Diagram | undefined` to a discriminated union.** OpenAPI's uuid-title fallback is updated in the same Task 1 commit (mechanical); its observable behavior is unchanged.

## File structure (before tasks)

| File | Responsibility |
|---|---|
| `src/utils/documentOpening/types.ts` | Widen `LegacyFallback` / `DocumentOrigin`; add `DefaultDocContext` |
| `src/utils/documentOpening/openDocument.ts` | Consume new fallback results; write-policy default-doc synthesis |
| `src/utils/documentOpening/openDocument.spec.ts` | Pipeline contract tests |
| `src/utils/documentOpening/targets/openApiTarget.ts` | Mechanical fallback return-shape + `defaultDoc({ blocked })` update |
| `src/utils/documentOpening/targets/openApiTarget.spec.ts` | Keep green under new return shape |
| `src/forge-swagger-editor.ts` | Drop the 3-branch fail-closed synthesis (uses pipeline output) |
| `src/utils/documentOpening/targets/graphTarget.ts` | Graph `TargetSpec` (viewer + editor) |
| `src/utils/documentOpening/targets/graphTarget.spec.ts` | Graph target unit tests |
| `src/forge-graph-viewer.ts` | Thin `openDocument` caller |
| `src/forge-graph-editor.ts` | Thin `openDocument` caller; keep save/writeback/journey |
| `src/components/Viewer/ForgeGraphViewer.vue` | Terminal error when `loadError` set |

---

### Task 1: Widen pipeline contracts + collapse write-policy fail-closed synthesis (TDD)

**Files:**
- Modify: `src/utils/documentOpening/types.ts`
- Modify: `src/utils/documentOpening/openDocument.ts`
- Modify: `src/utils/documentOpening/openDocument.spec.ts`
- Modify: `src/utils/documentOpening/targets/openApiTarget.ts`
- Modify: `src/utils/documentOpening/targets/openApiTarget.spec.ts`
- Modify: `src/forge-swagger-editor.ts`

**Interfaces:**
- Produces: `LegacyFallbackResult`, updated `LegacyFallback`, `DefaultDocContext`, extended `DocumentOrigin`, updated `TargetSpec.defaultDoc` signature, updated `openDocument` write-policy behavior.
- Consumes: existing `loadCustomContentWithOrphanRecovery`, `reportOrphanObserved`.

- [ ] **Step 1: Update `types.ts`**

Replace the `LegacyFallback` typedef and extend `DocumentOrigin` / `TargetSpec.defaultDoc`:

```ts
/**
 * Result of one family-specific recovery step.
 * - `found`: recovered a doc (caller stamps recoveredFromOrphan).
 * - `miss`: clean absence — try the next fallback (or fall through to
 *   onMiss / failed).
 * - `indeterminate`: the step could not prove absence (forbidden / page
 *   unreachable / unexpected value shape / transport error). Under write
 *   policy the pipeline latches this into origin.legacyLoadBlocked unless a
 *   later fallback returns `found` (which clears the latch — mirrors
 *   forge-graph-editor.ts clearing blocked when uuid-title recovery hits
 *   after a content-property probe failed indeterminately).
 */
export type LegacyFallbackResult =
  | { status: 'found'; doc: Diagram }
  | { status: 'miss' }
  | { status: 'indeterminate' };

export type LegacyFallback = (
  ctx: LegacyFallbackContext,
) => Promise<LegacyFallbackResult>;

/** Argument passed to `TargetSpec.defaultDoc` under write-policy synthesis. */
export interface DefaultDocContext {
  /**
   * True when the open ended without a recovered doc AND at least one
   * probe was indeterminate (direct fetch `other_error`, or a fallback
   * returned `indeterminate` that no later `found` cleared). Families use
   * this to stamp `legacyLoadBlocked` / `isNew` on their default doc —
   * the pipeline itself never inspects diagramType.
   */
  blocked: boolean;
}

export interface TargetSpec {
  resolveId(context: any): ResolvedTarget | undefined;
  legacyFallbacks: LegacyFallback[];
  onMiss: 'default-doc' | 'fail';
  /**
   * Called whenever write-policy synthesis (or a brand-new-macro miss with
   * onMiss='default-doc') needs a doc. MUST return a fresh object each
   * call. When `blocked` is true the returned doc MUST carry
   * `legacyLoadBlocked: true` (and any family-specific fields such as
   * Graph's `isNew: false`); when false it must NOT set legacyLoadBlocked.
   */
  defaultDoc?: (ctx: DefaultDocContext) => Diagram;
  macroType: OrphanDiagramKind;
}

export interface DocumentOrigin {
  contentId?: string;
  source?: TargetSource;
  recoveredFromOrphan: boolean;
  originalCustomContentId?: string;
  recoveryPageId?: string;
  /** Write-policy fail-closed latch — see LegacyFallbackResult.indeterminate. */
  legacyLoadBlocked?: boolean;
  isCopy?: boolean;
  copyReason?: 'cross-page' | 'same-page-duplicate';
}
```

- [ ] **Step 2: Write the new / updated failing tests in `openDocument.spec.ts`**

Add (and adjust existing fallback stubs that currently return `Diagram | undefined`):

```ts
it('legacy fallback found: opens, recoveredFromOrphan=true, copies isCopy/copyReason onto origin', async () => {
  vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
    customContent: undefined,
    directFetchStatus: 'not_found',
  } as any);
  const doc = { ...NULL_DIAGRAM, code: 'x', isCopy: true, copyReason: 'cross-page' as const };
  const target = baseTarget({
    legacyFallbacks: [async () => ({ status: 'found', doc })],
  });
  const outcome = await openDocument({ policy: 'write', context: {}, pageId: 'p1', target });
  expect(outcome.kind).toBe('opened');
  if (outcome.kind !== 'opened') return;
  expect(outcome.document.origin).toMatchObject({
    recoveredFromOrphan: true,
    isCopy: true,
    copyReason: 'cross-page',
    legacyLoadBlocked: undefined,
    originalCustomContentId: 'cc-1',
    recoveryPageId: 'p1',
  });
});

it('write + onMiss=default-doc + fallback indeterminate then miss: opens defaultDoc({blocked:true}) with origin.legacyLoadBlocked', async () => {
  vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
    customContent: undefined,
    directFetchStatus: 'not_found',
  } as any);
  const target = baseTarget({
    onMiss: 'default-doc',
    defaultDoc: ({ blocked }) => ({ ...NULL_DIAGRAM, ...(blocked ? { legacyLoadBlocked: true } : {}) }),
    legacyFallbacks: [
      async () => ({ status: 'indeterminate' }),
      async () => ({ status: 'miss' }),
    ],
  });
  const outcome = await openDocument({ policy: 'write', context: {}, pageId: 'p1', target });
  expect(outcome).toEqual({
    kind: 'opened',
    document: {
      doc: { ...NULL_DIAGRAM, legacyLoadBlocked: true },
      origin: {
        recoveredFromOrphan: false,
        legacyLoadBlocked: true,
        recoveryPageId: 'p1',
        // originalCustomContentId omitted — save is refused; self-heal must not fire
      },
    },
  });
});

it('write + fallback indeterminate then later found: clears the blocked latch', async () => {
  vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
    customContent: undefined,
    directFetchStatus: 'not_found',
  } as any);
  const recovered = { ...NULL_DIAGRAM, code: 'recovered' };
  const target = baseTarget({
    onMiss: 'default-doc',
    defaultDoc: ({ blocked }) => ({ ...NULL_DIAGRAM, ...(blocked ? { legacyLoadBlocked: true } : {}) }),
    legacyFallbacks: [
      async () => ({ status: 'indeterminate' }),
      async () => ({ status: 'found', doc: recovered }),
    ],
  });
  const outcome = await openDocument({ policy: 'write', context: {}, pageId: 'p1', target });
  expect(outcome.kind).toBe('opened');
  if (outcome.kind !== 'opened') return;
  expect(outcome.document.doc).toBe(recovered);
  expect(outcome.document.origin.legacyLoadBlocked).toBeUndefined();
  expect(outcome.document.origin.recoveredFromOrphan).toBe(true);
});

it('write + onMiss=default-doc + directFetchStatus=other_error + all miss: blocked default doc', async () => {
  vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
    customContent: undefined,
    directFetchStatus: 'other_error',
  } as any);
  const target = baseTarget({
    onMiss: 'default-doc',
    defaultDoc: ({ blocked }) => ({ ...NULL_DIAGRAM, ...(blocked ? { legacyLoadBlocked: true } : {}) }),
    legacyFallbacks: [async () => ({ status: 'miss' })],
  });
  const outcome = await openDocument({ policy: 'write', context: {}, pageId: 'p1', target });
  expect(outcome.kind).toBe('opened');
  if (outcome.kind !== 'opened') return;
  expect(outcome.document.doc.legacyLoadBlocked).toBe(true);
  expect(outcome.document.origin.legacyLoadBlocked).toBe(true);
});

it('write + onMiss=default-doc + confirmed not_found + all miss: unblocked default doc with originalCustomContentId for self-heal', async () => {
  vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
    customContent: undefined,
    directFetchStatus: 'not_found',
  } as any);
  const target = baseTarget({
    onMiss: 'default-doc',
    defaultDoc: ({ blocked }) => ({ ...NULL_DIAGRAM, ...(blocked ? { legacyLoadBlocked: true } : {}) }),
    legacyFallbacks: [async () => ({ status: 'miss' })],
  });
  const outcome = await openDocument({ policy: 'write', context: {}, pageId: 'p1', target });
  expect(outcome).toEqual({
    kind: 'opened',
    document: {
      doc: { ...NULL_DIAGRAM },
      origin: {
        contentId: 'cc-1',
        source: 'config',
        recoveredFromOrphan: false,
        originalCustomContentId: 'cc-1',
        recoveryPageId: 'p1',
      },
    },
  });
});

it('read + onMiss=fail + fallback indeterminate: still returns failed (viewers do not synthesize a default doc)', async () => {
  vi.mocked(globals.apWrapper.loadCustomContentWithOrphanRecovery).mockResolvedValue({
    customContent: undefined,
    directFetchStatus: 'not_found',
  } as any);
  const target = baseTarget({
    onMiss: 'fail',
    legacyFallbacks: [async () => ({ status: 'indeterminate' })],
  });
  const outcome = await openDocument({ policy: 'read', context: {}, target });
  expect(outcome).toEqual({
    kind: 'failed',
    error: { kind: 'not_found', customContentId: 'cc-1', indeterminate: true },
  });
});
```

Update every existing test stub that returns a bare `Diagram` / `undefined` from a fallback to the new `{ status }` shape. Update the existing `no id, onMiss=default-doc` test so `defaultDoc` takes `({ blocked })` (and still returns a fresh copy).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run src/utils/documentOpening/openDocument.spec.ts`
Expected: FAIL — `LegacyFallback` / `defaultDoc` signatures and new cases not implemented.

- [ ] **Step 4: Implement `openDocument.ts`**

```ts
export async function openDocument(opts: OpenDocumentOptions): Promise<OpenOutcome> {
  const { policy, context, pageId, target } = opts;
  const resolved = target.resolveId(context);

  let doc: Diagram | undefined;
  let recoveredFromOrphan = false;
  let directFetchStatus: 'ok' | 'not_found' | 'other_error' | undefined;
  let fallbackIndeterminate = false;

  if (resolved?.contentId) {
    const { contentId } = resolved;
    const copyCheckMode = policy === 'read' ? 'cross-page-only' : 'full';
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
      pageId, contentId, { copyCheckMode },
    );
    doc = loaded.customContent?.value;
    directFetchStatus = loaded.directFetchStatus;

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
    }
  }

  if (!doc) {
    for (const fallback of target.legacyFallbacks) {
      const result = await fallback({ context, pageId });
      if (result.status === 'found') {
        doc = result.doc;
        recoveredFromOrphan = true;
        fallbackIndeterminate = false; // later found clears an earlier latch
        break;
      }
      if (result.status === 'indeterminate') {
        fallbackIndeterminate = true;
        // continue — a later fallback may still find a doc
      }
    }
  }

  if (doc) {
    return {
      kind: 'opened',
      document: {
        doc,
        origin: {
          contentId: resolved?.contentId,
          source: resolved?.source,
          recoveredFromOrphan,
          originalCustomContentId: resolved?.contentId,
          recoveryPageId: pageId,
          isCopy: doc.isCopy,
          copyReason: doc.copyReason,
        },
      },
    };
  }

  const blocked =
    fallbackIndeterminate ||
    (resolved?.contentId != null && directFetchStatus === 'other_error');

  // Brand-new macro (no id resolved, nothing indeterminate): open default.
  if (!resolved?.contentId && !blocked && target.onMiss === 'default-doc') {
    return {
      kind: 'opened',
      document: {
        doc: target.defaultDoc!({ blocked: false }),
        origin: { recoveredFromOrphan: false },
      },
    };
  }

  // Write-policy synthesis: editors declare onMiss='default-doc' and always
  // get an `opened` outcome — blocked or self-heal — so call sites do not
  // re-implement the fail-closed three-way branch.
  if (target.onMiss === 'default-doc') {
    return {
      kind: 'opened',
      document: {
        doc: target.defaultDoc!({ blocked }),
        origin: {
          recoveredFromOrphan: false,
          legacyLoadBlocked: blocked || undefined,
          recoveryPageId: pageId,
          ...(blocked
            ? {}
            : {
                contentId: resolved?.contentId,
                source: resolved?.source,
                originalCustomContentId: resolved?.contentId,
              }),
        },
      },
    };
  }

  return {
    kind: 'failed',
    error: {
      kind: 'not_found',
      customContentId: resolved?.contentId,
      // Read/fail path: indeterminate from direct fetch OR any fallback latch
      indeterminate: blocked,
    },
  };
}
```

- [ ] **Step 5: Update `openApiTarget.ts` (+ its spec) to the new shapes**

```ts
function makeUuidTitleFallback(surface: 'viewer' | 'editor'): LegacyFallback {
  return async ({ context, pageId }) => {
    const storageUuid = context.extension?.config?.uuid;
    if (!storageUuid) return { status: 'miss' };
    const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
    if (!recovered?.value) return { status: 'miss' };
    const doc = recovered.value;
    doc.recoveredFromOrphan = true;
    trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
      surface,
      macro_type: 'openapi',
      recovered_id: String(recovered.id ?? ''),
      is_copy: doc.isCopy ? 'true' : 'false',
      ...(pageId && { page_id: pageId }),
    });
    return { status: 'found', doc };
  };
}

export function buildOpenApiEditorTarget(): TargetSpec {
  return {
    resolveId: resolveOpenApiId,
    legacyFallbacks: [makeUuidTitleFallback('editor')],
    onMiss: 'default-doc',
    defaultDoc: ({ blocked }) => ({
      ...NULL_DIAGRAM,
      ...(blocked ? { legacyLoadBlocked: true } : {}),
    }),
    macroType: 'openapi',
  };
}
```

(`buildOpenApiViewerTarget` only changes the fallback return shape — still `onMiss: 'fail'`.)

Update `openApiTarget.spec.ts` expectations from bare `Diagram` / `undefined` to `{ status: 'found' | 'miss', ... }`.

- [ ] **Step 6: Simplify `forge-swagger-editor.ts`'s `mountEditorDocument`**

Replace the 3-branch synthesis with:

```ts
    const outcome = await openDocument({
      policy: 'write',
      context,
      pageId: recoveryPageId,
      target: buildOpenApiEditorTarget(),
    });

    // write + onMiss=default-doc always opens (Task 1). Blocked / self-heal
    // are expressed on document.origin + doc.legacyLoadBlocked.
    if (outcome.kind !== 'opened') {
      throw new Error('openDocument(write, openapi editor) returned failed — TargetSpec.onMiss must be default-doc');
    }
    const doc = outcome.document.doc;
    capturedOrigin = {
      originalCustomContentId: outcome.document.origin.originalCustomContentId,
      recoveryPageId: outcome.document.origin.recoveryPageId,
      recoveredFromOrphan: outcome.document.origin.recoveredFromOrphan,
    };
```

Delete the `else if (outcome.error.indeterminate)` / `else` branches. Keep the dashboard-edit / store / window.diagram / analytics code below unchanged.

- [ ] **Step 7: Verify**

Run: `pnpm exec vitest run src/utils/documentOpening/`
Expected: PASS.

Run: `pnpm test:unit` (full suite green; OpenAPI editor has no unit file — covered by pipeline tests + the call-site simplification being a pure deletion of branches whose outcomes the new tests assert).

- [ ] **Step 8: Commit**

```bash
git add src/utils/documentOpening/ src/forge-swagger-editor.ts
git commit -m "$(cat <<'EOF'
refactor(documentOpening): express indeterminate legacy fallbacks and write-policy fail-closed in the pipeline

Widen LegacyFallback beyond Diagram|undefined so Graph's content-property
probe can latch legacyLoadBlocked, and synthesize write+default-doc outcomes
inside openDocument so editors stop re-implementing the three-way branch.
EOF
)"
```

---

### Task 2: Graph `TargetSpec` (TDD)

**Files:**
- Create: `src/utils/documentOpening/targets/graphTarget.ts`
- Create: `src/utils/documentOpening/targets/graphTarget.spec.ts`

**Interfaces:**
- Consumes: `TargetSpec`, `LegacyFallback`, `ResolvedTarget`, `DefaultDocContext` (Task 1). `globals.apWrapper.getContentPropertyV2`, `globals.apWrapper.findLegacyCustomContentByUuid`. `decompress` (`@/utils/compress`). Legacy content-property telemetry helpers. `trackEvent`.
- Produces: `resolveGraphId`, `buildGraphViewerTarget`, `buildGraphEditorTarget`, `EMPTY_GRAPH` (exported for the editor's `window.graphXml` fallback only if still needed — prefer keeping the XML string inside `graphTarget.ts` and letting `defaultDoc` own it).

- [ ] **Step 1: Write the failing tests** — `graphTarget.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveGraphId,
  buildGraphViewerTarget,
  buildGraphEditorTarget,
  EMPTY_GRAPH,
} from './graphTarget';
import { DiagramType, DataSource } from '@/model/Diagram/Diagram';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getContentPropertyV2: vi.fn(),
      findLegacyCustomContentByUuid: vi.fn(),
    },
  },
}));
vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }));
vi.mock('@/utils/legacyContentPropertyTelemetry', () => ({
  reportLegacyContentPropertyRestored: vi.fn(),
  reportLegacyContentPropertyLoadFailed: vi.fn(),
  reportLegacyContentPropertyValueUnexpected: vi.fn(),
}));
vi.mock('@/utils/compress', () => ({
  decompress: vi.fn((s: string) => `DECOMPRESSED:${s}`),
}));

import globals from '@/model/globals';
import { decompress } from '@/utils/compress';
import {
  reportLegacyContentPropertyRestored,
  reportLegacyContentPropertyLoadFailed,
  reportLegacyContentPropertyValueUnexpected,
} from '@/utils/legacyContentPropertyTelemetry';

describe('resolveGraphId', () => {
  it('returns config.customContentId with source config', () => {
    expect(resolveGraphId({ extension: { config: { customContentId: 'g1' } } }))
      .toEqual({ contentId: 'g1', source: 'config' });
  });
  it('returns undefined when no config id (Graph has no modal id source)', () => {
    expect(resolveGraphId({ extension: { modal: { customContentId: 'm1' } } })).toBeUndefined();
  });
});

describe('buildGraphViewerTarget legacyFallbacks', () => {
  const target = () => buildGraphViewerTarget();
  const ctx = {
    context: { extension: { config: { uuid: 'u-1' } } },
    pageId: 'page-1',
  };

  beforeEach(() => vi.clearAllMocks());

  it('content-property object value → found, decompressed, telemetry restored', async () => {
    vi.mocked(globals.apWrapper.getContentPropertyV2).mockResolvedValue({
      status: 'ok',
      property: { value: { graphXml: 'COMPRESSED', compressed: true, title: 't' } },
    } as any);
    const result = await target().legacyFallbacks[0](ctx);
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(decompress).toHaveBeenCalled();
    expect(result.doc.graphXml).toBe('DECOMPRESSED:COMPRESSED');
    expect(result.doc.compressed).toBe(false);
    expect(result.doc.diagramType).toBe(DiagramType.Graph);
    expect(result.doc.source).toBe(DataSource.ContentProperty);
    expect(result.doc.id).toBeUndefined();
    expect(result.doc.recoveredFromOrphan).toBe(true);
    expect(reportLegacyContentPropertyRestored).toHaveBeenCalledWith('viewer', 'graph', 'u-1', { pageId: 'page-1' });
    // uuid-title not consulted when content-property hits
    expect(globals.apWrapper.findLegacyCustomContentByUuid).not.toHaveBeenCalled();
  });

  it('content-property not_found → miss (does not latch indeterminate)', async () => {
    vi.mocked(globals.apWrapper.getContentPropertyV2).mockResolvedValue({ status: 'not_found' } as any);
    await expect(target().legacyFallbacks[0](ctx)).resolves.toEqual({ status: 'miss' });
  });

  it('content-property forbidden → indeterminate + loadFailed telemetry', async () => {
    vi.mocked(globals.apWrapper.getContentPropertyV2).mockResolvedValue({ status: 'forbidden' } as any);
    await expect(target().legacyFallbacks[0](ctx)).resolves.toEqual({ status: 'indeterminate' });
    expect(reportLegacyContentPropertyLoadFailed).toHaveBeenCalledWith(
      'viewer', 'graph', 'u-1', 'forbidden', { pageId: 'page-1' },
    );
  });

  it('content-property page_not_found / error / unexpected string → indeterminate', async () => {
    for (const status of ['page_not_found', 'error'] as const) {
      vi.mocked(globals.apWrapper.getContentPropertyV2).mockResolvedValue(
        status === 'error' ? { status, reason: 'http', httpStatus: 500 } as any : { status } as any,
      );
      await expect(target().legacyFallbacks[0](ctx)).resolves.toEqual({ status: 'indeterminate' });
    }
    vi.mocked(globals.apWrapper.getContentPropertyV2).mockResolvedValue({
      status: 'ok', property: { value: 'not-an-object' },
    } as any);
    await expect(target().legacyFallbacks[0](ctx)).resolves.toEqual({ status: 'indeterminate' });
    expect(reportLegacyContentPropertyValueUnexpected).toHaveBeenCalled();
  });

  it('uuid-title fallback found → found + trackEvent', async () => {
    const doc = { graphXml: '<mxGraphModel/>', isCopy: true } as any;
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue({ id: 'cc-9', value: doc });
    const result = await target().legacyFallbacks[1](ctx);
    expect(result).toEqual({ status: 'found', doc: { ...doc, recoveredFromOrphan: true } });
  });

  it('no storageUuid → both fallbacks miss without calling apWrapper', async () => {
    const empty = { context: { extension: { config: {} } }, pageId: 'page-1' };
    await expect(target().legacyFallbacks[0](empty)).resolves.toEqual({ status: 'miss' });
    await expect(target().legacyFallbacks[1](empty)).resolves.toEqual({ status: 'miss' });
    expect(globals.apWrapper.getContentPropertyV2).not.toHaveBeenCalled();
    expect(globals.apWrapper.findLegacyCustomContentByUuid).not.toHaveBeenCalled();
  });
});

describe('buildGraphEditorTarget', () => {
  it('onMiss=default-doc; defaultDoc({blocked:false}) is fresh EMPTY_GRAPH with isNew true', () => {
    const t = buildGraphEditorTarget();
    expect(t.onMiss).toBe('default-doc');
    const a = t.defaultDoc!({ blocked: false });
    const b = t.defaultDoc!({ blocked: false });
    expect(a).toEqual({
      diagramType: DiagramType.Graph,
      graphXml: EMPTY_GRAPH,
      isNew: true,
    });
    expect(a).not.toBe(b);
  });
  it('defaultDoc({blocked:true}) sets legacyLoadBlocked and isNew false', () => {
    const doc = buildGraphEditorTarget().defaultDoc!({ blocked: true });
    expect(doc).toEqual({
      diagramType: DiagramType.Graph,
      graphXml: EMPTY_GRAPH,
      isNew: false,
      legacyLoadBlocked: true,
    });
  });
  it('editor content-property fallback uses surface=editor in telemetry', async () => {
    vi.mocked(globals.apWrapper.getContentPropertyV2).mockResolvedValue({
      status: 'ok',
      property: { value: { graphXml: '<mxGraphModel/>' } },
    } as any);
    await buildGraphEditorTarget().legacyFallbacks[0]({
      context: { extension: { config: { uuid: 'u-1' } } },
      pageId: 'p',
    });
    expect(reportLegacyContentPropertyRestored).toHaveBeenCalledWith('editor', 'graph', 'u-1', { pageId: 'p' });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm exec vitest run src/utils/documentOpening/targets/graphTarget.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `graphTarget.ts`**

Lift the content-property + uuid-title blocks verbatim from `forge-graph-viewer.ts:57-116` / `forge-graph-editor.ts:294-374`, returning `LegacyFallbackResult` instead of mutating a shared `doc` / `legacyLoadBlocked` local. Key details that must not drift:

- Property key: `` `zenuml-graph-macro-${storageUuid}-body` `` — uuid from `context.extension?.config?.uuid` only (never `localId`).
- Decompress when `compressed && graphXml && !graphXml.startsWith('<mxGraphModel')`.
- On success: `diagramType: Graph`, `source: ContentProperty`, `id: undefined`, `recoveredFromOrphan: true`, `compressed: false`.
- `not_found` → `{ status: 'miss' }` (editor and viewer identical — the editor's fail-closed latch is owned by `indeterminate` statuses only).
- `forbidden` / `page_not_found` / `error` / unexpected value shape → `{ status: 'indeterminate' }` + the same telemetry the editor fires today (viewer today only reports loadFailed for non-not_found; **keep viewer telemetry exactly as `forge-graph-viewer.ts` does today** — it does NOT set a save block, and it already calls `reportLegacyContentPropertyLoadFailed` / `ValueUnexpected` on those paths).
- Uuid-title fallback: on hit, stamp `recoveredFromOrphan: true` and fire `legacy_custom_content_by_uuid_restored` with the correct `surface`.

```ts
export const EMPTY_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

export function resolveGraphId(context: any): ResolvedTarget | undefined {
  const contentId = context.extension?.config?.customContentId;
  if (!contentId) return undefined;
  return { contentId, source: 'config' };
}

export function buildGraphViewerTarget(): TargetSpec {
  return {
    resolveId: resolveGraphId,
    legacyFallbacks: [
      makeContentPropertyFallback('viewer'),
      makeUuidTitleFallback('viewer'),
    ],
    onMiss: 'fail',
    macroType: 'graph',
  };
}

export function buildGraphEditorTarget(): TargetSpec {
  return {
    resolveId: resolveGraphId,
    legacyFallbacks: [
      makeContentPropertyFallback('editor'),
      makeUuidTitleFallback('editor'),
    ],
    onMiss: 'default-doc',
    defaultDoc: ({ blocked }) => ({
      diagramType: DiagramType.Graph,
      graphXml: EMPTY_GRAPH,
      isNew: !blocked,
      ...(blocked ? { legacyLoadBlocked: true } : {}),
    }),
    macroType: 'graph',
  };
}
```

Implement `makeContentPropertyFallback` / `makeUuidTitleFallback` as private factories taking `surface: 'viewer' | 'editor'`.

- [ ] **Step 4: Verify** — `pnpm exec vitest run src/utils/documentOpening/targets/graphTarget.spec.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/documentOpening/targets/graphTarget.ts src/utils/documentOpening/targets/graphTarget.spec.ts
git commit -m "feat(documentOpening): Graph TargetSpec — content-property + uuid-title fallbacks"
```

---

### Task 3: Migrate the Graph viewer + terminal error UI

**Files:**
- Modify: `src/forge-graph-viewer.ts` — delete the inline `loadDiagram` recovery chain (`:19-119`); call `openDocument`.
- Modify: `src/components/Viewer/ForgeGraphViewer.vue` — show terminal message when `loadError` is set (mirror `OpenApiViewer.vue`).

**Interfaces:**
- Consumes: `openDocument`, `buildGraphViewerTarget`, `resolveGraphId`, `ViewerLoadDiagramResult` / `bootstrapForgeViewer` (existing).
- Produces: no new exports.

- [ ] **Step 1: Rewrite `loadDiagram` in `forge-graph-viewer.ts`**

```ts
import { bootstrapForgeViewer, type ViewerLoadDiagramResult } from '@/utils/viewerBootstrap';
import { openDocument } from '@/utils/documentOpening/openDocument';
import { buildGraphViewerTarget, resolveGraphId } from '@/utils/documentOpening/targets/graphTarget';

async function loadDiagram(): Promise<ViewerLoadDiagramResult> {
  const context = await initForgeContext();
  const pageId = context.extension?.content?.id;
  const outcome = await openDocument({
    policy: 'read',
    context,
    pageId,
    target: buildGraphViewerTarget(),
  });
  if (outcome.kind === 'failed') {
    return { doc: undefined, loadError: outcome.error };
  }
  return { doc: outcome.document.doc, loadError: null };
}
```

Keep `afterLoad` (compressed_* telemetry + `createAttachmentIfContentChanged`) and the Edit-click `guardEditClick` / `openModal` listener byte-identical. Update `resolveContentId` to `(context) => resolveGraphId(context)?.contentId`.

Delete now-unused imports (`decompress`, `DiagramType`/`DataSource` if unused, orphan/legacy telemetry imports that moved into `graphTarget`).

- [ ] **Step 2: Terminal error in `ForgeGraphViewer.vue`**

Mirror OpenAPI's pattern — inside the `generic-viewer` default slot, before the canvas:

```vue
      <div v-if="loadError" class="graph-load-error" role="status">
        This diagram isn't available.
      </div>
      <div v-else ref="graphContainer" class="graph-viewer-canvas" style="width:100%"></div>
```

Add a `loadError` computed (`this.$store.state.diagram?.loadError ?? null`). Gate `renderViewer()` so it no-ops when `loadError` is set. Keep `trackRenderTime('graph', ...)` firing on mount / load-complete the same way OpenAPI still reports `macro_viewed` on failure (readership metric — not success-only). If Graph today reports from `mounted` unconditionally, keep that; do not introduce a new analytics event.

- [ ] **Step 3: Verify**

Run: `pnpm exec vitest run src/utils/documentOpening/ src/utils/viewerBootstrap*.spec.ts tests/unit/viewerBootstrap-compressed-graph.spec.ts`
Expected: PASS. Manually confirm `forge-graph-viewer.ts` no longer references `getContentPropertyV2` / `findLegacyCustomContentByUuid`.

- [ ] **Step 4: Commit**

```bash
git add src/forge-graph-viewer.ts src/components/Viewer/ForgeGraphViewer.vue
git commit -m "refactor(graph): migrate the viewer onto the documentOpening pipeline"
```

---

### Task 4: Migrate the Graph editor

**Files:**
- Modify: `src/forge-graph-editor.ts` — delete the resolution / legacy-fallback / EMPTY_GRAPH synthesis block (`:269-383`); call `openDocument`; capture `OpenedDocument.origin` for the save handler.

**Interfaces:**
- Consumes: `openDocument`, `buildGraphEditorTarget` (Tasks 1–2). Existing `decideWriteback` / `deriveWritebackSignals` / `LegacyLoadBlockedSaveError` path stays.
- Produces: no new exports.

**No new `forge-graph-editor.spec.ts`.** Same reasoning as Slice 1 Task 5: side-effecting module, no exported seam. Regression gate = pipeline tests (Task 1/2) + the mandatory derivation cross-check below + fullscreen e2e spot check in Task 5.

- [ ] **Step 1: Replace module-scope capture + resolution block**

Delete:

```ts
let originalCustomContentId: string | undefined;
let recoveryPageId: string | undefined;
```

and the entire load/fallback/EMPTY_GRAPH block inside `initializeMacro` from `let doc: Diagram | undefined; let legacyLoadBlocked = false;` through `if (!doc) { doc = { ... EMPTY_GRAPH ... } }`.

Replace with:

```ts
import { openDocument } from '@/utils/documentOpening/openDocument';
import { buildGraphEditorTarget, EMPTY_GRAPH } from '@/utils/documentOpening/targets/graphTarget';

let capturedOrigin: {
  originalCustomContentId?: string;
  recoveryPageId?: string;
  recoveredFromOrphan: boolean;
  legacyLoadBlocked?: boolean;
} = { recoveredFromOrphan: false };

// inside initializeMacro, after journey/session setup and originalConfigUuid snapshot:
  const customContentId = context.extension?.config?.customContentId;
  const pageId = context.extension?.content?.id;

  const outcome = await openDocument({
    policy: 'write',
    context,
    pageId,
    target: buildGraphEditorTarget(),
  });
  if (outcome.kind !== 'opened') {
    throw new Error('openDocument(write, graph editor) returned failed — TargetSpec.onMiss must be default-doc');
  }
  const doc = outcome.document.doc;
  capturedOrigin = {
    originalCustomContentId: outcome.document.origin.originalCustomContentId,
    recoveryPageId: outcome.document.origin.recoveryPageId ?? pageId,
    recoveredFromOrphan: outcome.document.origin.recoveredFromOrphan,
    legacyLoadBlocked: outcome.document.origin.legacyLoadBlocked,
  };

  store.state.diagram = doc;
  window.diagram = doc;
```

Keep the post-load `compressed` → `window.graphXml` normalization, `tryPageEditorPaywall` / `mountRoot`, and analytics exactly as they are. `EMPTY_GRAPH` import remains available if the compressed/window.graphXml path needs a fallback string — otherwise delete the local `const EMPTY_GRAPH = …` duplicate.

- [ ] **Step 2: Point `saveGraphAndExit`'s derivation + repair telemetry at `capturedOrigin`**

```ts
  const derivationInput = {
    sourceId,
    newId: id,
    originalCustomContentId: capturedOrigin.originalCustomContentId,
    docSource: window.diagram?.source,
    recoveredFromOrphan: capturedOrigin.recoveredFromOrphan,
  };
  // ...
        if (attemptRepair && capturedOrigin.originalCustomContentId) {
          reportOrphanMacroRepaired(
            capturedOrigin.recoveryPageId,
            capturedOrigin.originalCustomContentId,
            id,
            'graph',
          );
        }
        if (attemptLegacyMigration && originalConfigUuid) {
          reportLegacyContentPropertyMacroRepaired('graph', originalConfigUuid, id, {
            pageId: capturedOrigin.recoveryPageId,
          });
        }
```

The `LegacyLoadBlockedSaveError` catch already exists — leave its toast wording alone (Graph still uses legacy content properties; the OpenAPI-specific rewording does not apply here).

- [ ] **Step 3: Mandatory derivation cross-check** (write into the PR description verbatim)

| Field | OLD source | NEW source | Equivalent? |
|---|---|---|---|
| `sourceId` | `diagram?.id` before save | unchanged | yes |
| `originalCustomContentId` | module var = `config.customContentId` at open | `origin.originalCustomContentId` (= resolved id, unset when blocked) | yes — blocked path never reaches writeback |
| `docSource` | `window.diagram?.source` | unchanged | yes |
| `recoveredFromOrphan` | `window.diagram?.recoveredFromOrphan` | `capturedOrigin.recoveredFromOrphan` (and doc still carries the flag) | yes |
| `recoveryPageId` (repair telemetry) | module var = `content.id` | `origin.recoveryPageId ?? pageId` | yes |
| `legacyLoadBlocked` on doc | local bool stamped onto EMPTY_GRAPH | `defaultDoc({ blocked })` / pipeline latch | yes — Persistence.ts still keys off `diagram.legacyLoadBlocked` |

- [ ] **Step 4: Verify** — `pnpm test:unit` green; `npx vue-tsc --noEmit 2>&1 | rg 'forge-graph-editor|documentOpening|ForgeGraphViewer' ` shows no NEW errors vs main.

- [ ] **Step 5: Commit**

```bash
git add src/forge-graph-editor.ts
git commit -m "refactor(graph): migrate the editor onto the documentOpening pipeline"
```

---

### Task 5: Validate, ship, staging spot check

**Files:** none new.

- [ ] **Step 1:** Unit / typecheck / build baseline

```bash
pnpm test:unit
pnpm run build:lite
# typecheck vs main — error count must not grow
npx vue-tsc --noEmit 2>&1 | tee /tmp/slice2-tsc.txt
git stash push -u -m 'slice2-wip' 2>/dev/null; git checkout origin/main --quiet
npx vue-tsc --noEmit 2>&1 | tee /tmp/main-tsc.txt
git checkout - --quiet; git stash pop 2>/dev/null
# compare counts
```

- [ ] **Step 2:** Confirm deletion gate — `forge-graph-viewer.ts` / `forge-graph-editor.ts` contain exactly one `openDocument(` call each and zero references to `getContentPropertyV2` / `findLegacyCustomContentByUuid` / inline `zenuml-graph-macro-` key construction.

```bash
rg -n 'openDocument|getContentPropertyV2|findLegacyCustomContentByUuid|zenuml-graph-macro-' src/forge-graph-viewer.ts src/forge-graph-editor.ts
```

Expected: `openDocument` ×1 per file; the other three patterns absent (they live only in `graphTarget.ts`).

- [ ] **Step 3:** Ship — PR against `main`, title referencing "Slice 2 of the content-opening unification". CI green = the authoritative `pull_request` run (build + unit + E2E Lite `suite: insert`). Remember: the `fullscreen` Playwright project does **not** run in GHA — do not cite CI as editor-path evidence.

- [ ] **Step 4:** Staging spot check on **lite-stg** (correct invocation — the Slice 1 lesson):

```bash
cd tests/e2e-tests
APP='zenuml-lite@stg' npx playwright test \
  tests/fullscreen/graph-create.spec.ts \
  tests/fullscreen/graph-edit.spec.ts \
  tests/fullscreen/writeback-gate-non-submittable.spec.ts \
  --project=fullscreen
```

Also manually:

1. Open an existing Graph macro on staging — confirms viewer render + `macro_viewed` still tags `surface: 'viewer'` / `isDisplayMode` correctly (#423 regression gate).
2. In-viewer Edit → Publish round-trip (write path).
3. If a Connect-era legacy Graph macro (content-property / uuid-title) exists in the test space, open it in viewer + editor and confirm restore; if none, the unit tests in Task 2 are the evidence for those branches.
4. Force a load failure (break `customContentId` on a test macro) and confirm the viewer terminal message appears instead of an empty canvas.

- [ ] **Step 5:** PR description must include the Task 4 derivation cross-check table and the ledger lines below.

## Ledger impact (spec acceptance table)

- Content-opening implementations for Graph: 2 (viewer `loadDiagram` + editor `initializeMacro` recovery chain, ~215 LOC orchestration) → 1 pipeline call + 1 `TargetSpec`.
- `LegacyFallback` can express indeterminate failure — Graph's data-loss protection preserved without call-site latching.
- `DocumentOrigin` carries `legacyLoadBlocked` / `isCopy` / `copyReason` (spec §3) — OpenAPI editor's 3-branch synthesis deleted.
- Copy-scan modes for Graph: ad hoc → policy-derived (`read` = cross-page-only, `write` = full) inside `openDocument` (already true for OpenAPI; Graph now joins).
- Fail-closed save protection: still Graph + OpenAPI; mechanism now shared (pipeline), not per-editor.
- Whole-file deletions: none yet (`viewerBootstrap.ts` still has graph + embed callers; retirement is Slice 4).
- Zero family branches inside `openDocument.ts`.

## Out of scope (do not do in this PR)

- Embed migration (Slice 3) and Sequence / `viewerBootstrap` retirement (Slice 4).
- Wiring the `fullscreen` Playwright project into GHA.
- Fixing pre-existing fullscreen e2e failures unrelated to Graph open/save.
- New Mixpanel catalog events / `surface` on `customcontent_orphan_observed`.
- Extracting the duplicated `EMPTY_GRAPH` constant out of `ForgeGraphEditor.vue` (presentation-side; untouched).
