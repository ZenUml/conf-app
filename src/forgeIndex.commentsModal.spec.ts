import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  context: {} as any,
  loadCustomContentWithOrphanRecovery: vi.fn(),
  graphViewerImported: vi.fn(),
  reportOrphanObserved: vi.fn(),
  mountRoot: vi.fn(),
  fullscreen: false,
  fullscreenGate: vi.fn().mockResolvedValue(false),
  installFeedbackHost: vi.fn(),
  mountCommentsModal: vi.fn(),
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
vi.mock('@/features/feedback/mountFeedback', () => ({ installFeedbackHost: h.installFeedbackHost, mountFeedbackModal: vi.fn() }));
vi.mock('@/features/diagramComments/mountComments', () => ({ mountCommentsModal: h.mountCommentsModal }));
vi.mock('@/utils/byline/revealDiagram', () => ({
  claimReveal: vi.fn(() => null),
  revealThisMacro: vi.fn(),
}));
vi.mock('@/EventBus', () => ({
  default: { $on: vi.fn(), $emit: vi.fn() },
}));

describe('Comments modal dispatch (#1047)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    localStorage.clear();
    h.fullscreen = false;
    h.context = {
      moduleKey: 'zenuml-mermaid-macro-lite',
      extension: { type: 'confluence:macro', content: { id: 'page-1' }, config: { customContentId: 'cc-1' } },
    };
  });

  it('mounts the panel and boots no viewer and no edge host inside the comments modal (no recursion)', async () => {
    h.context.extension.modal = { macroMode: 'comments', commentsContext: { pageId: '1' } };
    const { default: initialized } = await import('@/forgeIndex');
    await initialized;

    expect(h.mountCommentsModal).toHaveBeenCalledTimes(1);
    expect(h.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
    expect(h.mountRoot).not.toHaveBeenCalled();
    expect(h.installFeedbackHost).not.toHaveBeenCalled();
  });

  it('leaves an ordinary viewer alone: no comments modal, edge host installed', async () => {
    const { default: initialized } = await import('@/forgeIndex');
    await initialized;

    expect(h.mountCommentsModal).not.toHaveBeenCalled();
    expect(h.installFeedbackHost).toHaveBeenCalledTimes(1);
  });
});
