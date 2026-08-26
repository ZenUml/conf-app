import { describe, it, expect, beforeEach, vi } from 'vitest';
import store from '@/model/store2';
import globals from '@/model/globals';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import {
  applyViewerLoadOutcome,
  classifyViewerLoadOutcome,
  isDisplayableDiagram,
  mapCustomContentLoadError,
  mapThrownViewerLoadError,
  setSequenceViewerLoadState,
} from '@/utils/viewerLoadOutcome';
import Example from '@/utils/sequence/Example';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
    },
  },
}));

describe('viewerLoadOutcome', () => {
  beforeEach(() => {
    store.state.viewerLoadState = null;
    store.state.loadError = null;
    store.state.diagram = { ...NULL_DIAGRAM };
    vi.mocked(globals.apWrapper.isDisplayMode).mockReturnValue(true);
  });

  it('treats diagrams with renderable content as ready', () => {
    const doc = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A->B' };
    expect(isDisplayableDiagram(doc, 'sequence')).toBe(true);
    expect(classifyViewerLoadOutcome({ doc, customContentId: 'cc-1' }).state).toBe('ready');
  });

  it('treats a blank-but-loaded diagram (empty code, known type) as ready — not as a load failure', () => {
    const blankDoc = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: '' };
    expect(isDisplayableDiagram(blankDoc, 'sequence')).toBe(true);
    expect(classifyViewerLoadOutcome({ doc: blankDoc, customContentId: 'cc-1' }).state).toBe('ready');
  });

  it('fails fast when a renderable legacy document carries a TERMINAL Board load error', () => {
    const doc = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel><root /></mxGraphModel>',
      boardGraphXml: '',
    };
    const loadError = {
      errorClass: 'malformed' as const,
      errorCode: 'board_document_empty',
      terminal: true,
    };

    const outcome = classifyViewerLoadOutcome({
      doc,
      customContentId: 'cc-board',
      macroKind: 'graph',
      loadError,
    });

    expect(outcome.state).toBe('failed_with_source');
    expect(outcome.diagram).toBe(doc);
    expect(outcome.loadError).toBe(loadError);
  });

  // forge-graph-viewer.ts and forgeIndex.ts set a loadError when the
  // customContent fetch misses, and the ZEN-1170 legacy recovery paths BELOW
  // that point can still restore the body. Letting any error beat
  // displayability turned every successful recovery into an error panel.
  it('renders a recovered document when its load error is not terminal', () => {
    const doc = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel><root /></mxGraphModel>',
    };

    const outcome = classifyViewerLoadOutcome({
      doc,
      customContentId: 'cc-recovered',
      macroKind: 'graph',
      loadError: { errorClass: 'structured', errorCode: 'not_found' },
    });

    expect(outcome.state).toBe('ready');
    expect(outcome.diagram).toBe(doc);
    expect(outcome.loadError).toBeNull();
  });

  it('classifies missing content with a custom content id as failed_with_source', () => {
    const outcome = classifyViewerLoadOutcome({
      doc: undefined,
      customContentId: 'cc-404',
      loadError: { httpStatus: 404 },
    });
    expect(outcome.state).toBe('failed_with_source');
    expect(outcome.loadError).toEqual({ httpStatus: 404 });
  });

  it('classifies missing content without a custom content id as failed_without_source', () => {
    const outcome = classifyViewerLoadOutcome({ doc: undefined });
    expect(outcome.state).toBe('failed_without_source');
  });

  it('publishes viewer load state in display mode', () => {
    applyViewerLoadOutcome({
      doc: undefined,
      customContentId: 'cc-404',
      macroKind: 'openapi',
      loadError: { directFetchStatus: 'not_found' },
    });
    expect(store.state.viewerLoadState).toBe('failed_with_source');
    expect(store.state.loadError).toEqual({ directFetchStatus: 'not_found' });
    // The published diagram carries the load error too — components that
    // receive it as a `doc` prop (OpenApiViewer in the embed host / editor
    // preview) key their terminal state off diagram.loadError.
    expect(store.state.diagram).toStrictEqual({
      ...NULL_DIAGRAM,
      loadError: { directFetchStatus: 'not_found' },
    });
  });

  it('maps thrown load errors to structured diagnostics', () => {
    expect(mapThrownViewerLoadError(new Error('network down'))).toEqual({
      errorClass: 'thrown',
      errorCode: 'network down',
      httpStatus: undefined,
      directFetchStatus: undefined,
    });
    expect(mapThrownViewerLoadError({ status: 404, message: 'missing' })).toMatchObject({
      errorClass: 'thrown',
      httpStatus: 404,
      directFetchStatus: 'not_found',
    });
  });

  it('maps a custom-content load result into full support diagnostics', () => {
    // The fields below are exactly what loadCustomContentWithOrphanRecovery
    // surfaces on a failed direct fetch. Before the producer was wired up,
    // httpStatus/errorCode/errorClass were always undefined → "(unknown)".
    expect(
      mapCustomContentLoadError({
        directFetchStatus: 'other_error',
        directFetchHttpStatus: 403,
        directFetchErrorCode: 'FORBIDDEN',
        directFetchErrorClass: 'structured',
      }),
    ).toEqual({
      directFetchStatus: 'other_error',
      httpStatus: 403,
      errorCode: 'FORBIDDEN',
      errorClass: 'structured',
    });
  });

  it('returns null when a custom-content load carries no error metadata', () => {
    expect(mapCustomContentLoadError({})).toBeNull();
  });

  it('skips viewer load state in editor mode', () => {
    vi.mocked(globals.apWrapper.isDisplayMode).mockReturnValue(false);
    const doc = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A->B' };
    applyViewerLoadOutcome({ doc, customContentId: 'cc-1', macroKind: 'sequence' });
    expect(store.state.viewerLoadState).toBeNull();
    expect(store.state.diagram).toStrictEqual(doc);
  });
});

// Regression coverage for the 2026-08-19 overnight fix (commit 80565da3):
// forgeIndex.ts's content-SWR `mountSequenceViewer` — the single function
// shared by BOTH the cache-hit render and the background-revalidate remount
// — mounted the doc but never called setViewerLoadState, so
// store.state.viewerLoadState stayed at its initial `null` for ~66% of
// sequence-family viewer views (the file's own comment on the cache-SWR
// block gives that figure). Anything gated on `viewerLoadState === 'ready'`
// — SecondDiagramPrompt's `ready` prop, and DiagramAttributionFooter's
// registerDiagramImpactView call — was silently starved on the majority of
// real revisits.
//
// forgeIndex.ts itself has NO unit-test harness (confirmed by search: no
// forgeIndex.spec.ts exists, and importing the module runs side effects at
// module scope — CSS import, macroMetrics service instantiation, forge
// bridge globals — none of which are mocked anywhere in this suite). The fix
// was extracted into setSequenceViewerLoadState (the one line
// mountSequenceViewer now calls) precisely so it has a seam; these tests
// exercise that seam with the REAL doc shapes forgeIndex.ts's content-SWR
// cache produces at its two mountSequenceViewer call sites, read from the
// actual read/write code (contentCacheStore.ts + forgeIndex.ts lines
// ~478-480 and ~461-467) rather than an invented fixture.
describe('setSequenceViewerLoadState — content-SWR mount path regression (commit 80565da3)', () => {
  beforeEach(() => {
    store.state.viewerLoadState = null;
    store.state.loadError = null;
  });

  it('cache-hit path: a doc read back via JSON.parse(cached.doc) and the plantUmlCode ternary mounts as ready', () => {
    // Mirrors forgeIndex.ts's cache-hit block exactly:
    //   const cached = getCachedContent(customContentId);
    //   const cachedDoc = JSON.parse(cached.doc) as Diagram;
    //   const viewerDoc = cachedDoc.plantUmlCode ? cachedDoc : { ...cachedDoc, plantUmlCode: Example.PlantUml };
    // `cached.doc` is itself JSON.stringify(loaded.customContent.value) written
    // by putCachedContent (forgeIndex.ts line ~538) — round-trip it the same way.
    const fetchedDoc = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A->B: hello' };
    const cachedRaw = JSON.stringify(fetchedDoc);
    const cachedDoc = JSON.parse(cachedRaw) as typeof fetchedDoc;
    const viewerDoc = cachedDoc.plantUmlCode ? cachedDoc : { ...cachedDoc, plantUmlCode: Example.PlantUml };

    setSequenceViewerLoadState(viewerDoc);

    expect(store.state.viewerLoadState).toBe('ready');
  });

  it('background-revalidate remount path: a freshly-fetched doc mounts as ready', () => {
    // Mirrors revalidateSequenceViewer's remount (forgeIndex.ts line ~466-467):
    //   const freshDoc = fresh.plantUmlCode ? fresh : { ...fresh, plantUmlCode: Example.PlantUml };
    //   await mountSequenceViewer(freshDoc, freshAttribution);
    // `fresh` is `loaded.customContent?.value` straight off
    // loadCustomContentWithOrphanRecovery — the same Diagram shape a live
    // fetch produces, no plantUmlCode set for a sequence doc.
    const fresh = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A->B: hi again' };
    const freshDoc = fresh.plantUmlCode ? fresh : { ...fresh, plantUmlCode: Example.PlantUml };

    setSequenceViewerLoadState(freshDoc);

    expect(store.state.viewerLoadState).toBe('ready');
  });

  it('does not hardcode ready — a legacyLoadBlocked cached doc classifies as failed_with_source, matching applyViewerLoadOutcome', () => {
    // isDisplayableDiagram's first check is doc.legacyLoadBlocked (ZEN-1170
    // Defect 2b) — set when a legacy content-property read failed. Proves
    // setSequenceViewerLoadState really runs isDisplayableDiagram rather than
    // unconditionally publishing 'ready' for anything that reached mount.
    // (A merely blank-but-known-type doc, e.g. code: '', is BY DESIGN 'ready'
    // — see the "treats a blank-but-loaded diagram" case above — so it can't
    // serve as the negative case here.)
    const blockedCachedDoc = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Sequence,
      code: 'A->B: stale',
      plantUmlCode: Example.PlantUml,
      legacyLoadBlocked: true,
    };

    setSequenceViewerLoadState(blockedCachedDoc);

    expect(store.state.viewerLoadState).toBe('failed_with_source');
  });
});
