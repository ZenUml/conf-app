import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  context: {} as any,
  loadCustomContentWithOrphanRecovery: vi.fn(),
  graphViewerImported: vi.fn(),
  reportOrphanObserved: vi.fn(),
  mountRoot: vi.fn(),
  fullscreen: false,
  fullscreenGate: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      initializeContext: vi.fn(async () => undefined),
      getMacroData: vi.fn(async () => ({})),
      isLite: vi.fn(() => false),
      isDisplayMode: vi.fn(() => true),
      loadCustomContentWithOrphanRecovery: h.loadCustomContentWithOrphanRecovery,
    },
  },
}));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { localId: 'macro-1' } },
  getContext: vi.fn(async () => h.context),
  isEditorMode: vi.fn(async () => false),
  isFullscreenMode: vi.fn(async () => h.fullscreen),
  isExportEntry: vi.fn(async () => false),
  isInserting: vi.fn(async () => false),
  isConfiguring: vi.fn(async () => false),
  getView: vi.fn(async () => ({ close: vi.fn() })),
  openModal: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock('@/services/MacroMetrics', () => ({
  default: { getMacroMetrics: vi.fn(async () => ({})), reportMacroMetrics: vi.fn(async () => ({})) },
}));
vi.mock('@/utils/analytics/renderPerf', () => ({
  markAppEntry: vi.fn(),
  markContentSource: vi.fn(),
  time: vi.fn(async (_phase, action) => action()),
}));
vi.mock('@/utils/cohorts/userCohorts', () => ({ refreshUserCohortsIfStale: vi.fn() }));
vi.mock('@/utils/whatsNew/state', () => ({ markWhatsNewAudience: vi.fn() }));
vi.mock('@/utils/renderGate/maybeGateViewerRender', () => ({
  maybeGateViewerRender: vi.fn(async () => undefined),
  awaitGateBlocking: vi.fn(async () => undefined),
  getGateMode: vi.fn(() => 'load'),
}));
vi.mock('@/utils/orphanTelemetry', () => ({
  reportOrphanObserved: h.reportOrphanObserved,
  reportOrphanMacroRepaired: vi.fn(),
}));
vi.mock('@/model/Attachment', () => ({ default: vi.fn() }));
vi.mock('@/utils/paywall/mountPaywallGate', () => ({ tryFullscreenViewerPaywall: h.fullscreenGate, tryPageEditorPaywall: vi.fn().mockResolvedValue(false) }));
vi.mock('@/mount-root', () => ({ mountRoot: h.mountRoot }));
vi.mock('@/components/DiagramPortal.vue', () => ({ default: {} }));
vi.mock('@/forge-graph-viewer', () => {
  h.graphViewerImported();
  return { default: Promise.resolve() };
});
vi.mock('@/features/feedback/mountFeedback', () => ({ installFeedbackHost: vi.fn() }));
vi.mock('@/utils/byline/revealDiagram', () => ({
  claimReveal: vi.fn(() => null),
  revealThisMacro: vi.fn(),
}));
vi.mock('@/EventBus', () => ({
  default: { $on: vi.fn(), $emit: vi.fn() },
}));

describe('shared Forge entrypoint orphan routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    localStorage.clear();
    h.fullscreen = false;
    h.fullscreenGate.mockResolvedValue(false);
    h.context = {
      moduleKey: 'zenuml-graph-macro-lite',
      extension: {
        type: 'confluence:macro',
        content: { id: 'page-1' },
        config: { customContentId: 'orphan-1' },
      },
    };
  });

  it('preserves the failed-load state when recovery handles a fullscreen open', async () => {
    h.fullscreen = true;
    h.fullscreenGate.mockResolvedValue(true);
    h.context.moduleKey = 'zenuml-sequence-macro-lite';
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({ customContent: undefined, directFetchStatus: 'not_found', directFetchHttpStatus: 404 });
    const { default: initialized } = await import('@/forgeIndex'); await initialized;
    const { default: store } = await import('@/model/store2');
    expect(h.fullscreenGate).toHaveBeenCalledOnce();
    expect(store.state.viewerLoadState).toBe('failed_with_source');
    expect(h.mountRoot).not.toHaveBeenCalled();
  });

  it('delegates graph without loading or reporting it as a sequence orphan', async () => {
    const { default: initialized } = await import('@/forgeIndex');
    await initialized;

    expect(h.graphViewerImported).toHaveBeenCalledTimes(1);
    expect(h.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
    expect(h.reportOrphanObserved).not.toHaveBeenCalled();
  });
  it.each([
    {
      label: 'sequence macro',
      moduleKey: 'zenuml-sequence-macro-lite',
      modal: undefined,
    },
    {
      label: 'Mermaid modal',
      moduleKey: 'zenuml-byline-diagrams',
      modal: { diagramType: 'mermaid', macroMode: 'viewer' },
    },
  ])('loads and reports one sequence-family orphan for $label', async ({ moduleKey, modal }) => {
    h.context.moduleKey = moduleKey;
    if (modal) h.context.extension.modal = modal;
    const probeResult = {
      recoverable: false,
      candidateCount: 0,
      pageChildrenTotal: 0,
    };
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({
      customContent: undefined,
      directFetchStatus: 'not_found',
      directFetchHttpStatus: 404,
      directFetchErrorCode: 'NOT_FOUND',
      directFetchErrorClass: 'structured',
      probeResult,
    });

    const { default: initialized } = await import('@/forgeIndex');
    await initialized;

    expect(h.loadCustomContentWithOrphanRecovery).toHaveBeenCalledTimes(1);
    expect(h.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith(
      'page-1', 'orphan-1', { copyCheckMode: 'cross-page-only' },
    );
    expect(h.reportOrphanObserved).toHaveBeenCalledTimes(1);
    expect(h.reportOrphanObserved).toHaveBeenCalledWith(
      'page-1', 'orphan-1', 'sequence', probeResult,
      {
        recoveryUsed: false,
        directFetch: expect.objectContaining({
          directFetchStatus: 'not_found',
          directFetchHttpStatus: 404,
          directFetchErrorCode: 'NOT_FOUND',
          directFetchErrorClass: 'structured',
        }),
      },
    );
    expect(h.graphViewerImported).not.toHaveBeenCalled();
    expect(h.mountRoot).toHaveBeenCalledTimes(1);
  });

});
