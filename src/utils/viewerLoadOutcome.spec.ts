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
} from '@/utils/viewerLoadOutcome';

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
    expect(store.state.diagram).toStrictEqual(NULL_DIAGRAM);
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
