import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The sequence-family Publish handler must tell the editor that Publish has
// committed BEFORE it calls view.submit / view.close. Those calls tear the
// iframe down, often before their promise settles, so a draft cleared only
// on 'saved' (emitted after the await) survived publish and came back as a
// wrong "Unsaved changes" banner on the next new macro. The harness below is
// the one forgeIndex.publishTiming.spec.ts uses.
const h = vi.hoisted(() => ({
  saveToPlatform: vi.fn(),
  createAttachment: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  isInserting: vi.fn(),
  isConfiguring: vi.fn(),
  view: { close: vi.fn(), submit: vi.fn() },
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      initializeContext: vi.fn(async () => undefined),
      getMacroData: vi.fn(async () => ({})),
      isLite: vi.fn(() => false),
      isDisplayMode: vi.fn(() => true),
      loadCustomContentWithOrphanRecovery: vi.fn(),
    },
  },
}));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { localId: 'macro-1' } },
  getContext: vi.fn(async () => ({
    moduleKey: 'zenuml-graph-macro-lite',
    extension: { type: 'confluence:macro', content: { id: 'page-1' }, config: {} },
  })),
  isEditorMode: vi.fn(async () => false),
  isFullscreenMode: vi.fn(async () => false),
  isExportEntry: vi.fn(async () => false),
  isInserting: h.isInserting,
  isConfiguring: h.isConfiguring,
  getView: vi.fn(async () => h.view),
  openModal: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock('@/utils/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/window')>()),
  trackEvent: vi.fn(),
}));
vi.mock('@/services/MacroMetrics', () => ({
  default: { getMacroMetrics: vi.fn(async () => ({})), reportMacroMetrics: vi.fn(async () => ({})) },
}));
vi.mock('@/utils/analytics/renderPerf', () => ({
  markAppEntry: vi.fn(),
  markContentSource: vi.fn(),
  time: vi.fn(async (_phase, action) => action()),
}));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: h.trackAnalyticsEvent }));
vi.mock('@/utils/cohorts/userCohorts', () => ({ refreshUserCohortsIfStale: vi.fn() }));
vi.mock('@/utils/whatsNew/state', () => ({ markWhatsNewAudience: vi.fn() }));
vi.mock('@/utils/renderGate/maybeGateViewerRender', () => ({
  maybeGateViewerRender: vi.fn(async () => undefined),
  awaitGateBlocking: vi.fn(async () => undefined),
  getGateMode: vi.fn(() => 'load'),
}));
vi.mock('@/utils/orphanTelemetry', () => ({
  reportOrphanObserved: vi.fn(),
  reportOrphanMacroRepaired: vi.fn(),
}));
vi.mock('@/model/ContentProvider/Persistence', () => ({
  saveToPlatform: h.saveToPlatform,
  LegacyLoadBlockedSaveError: class extends Error {},
  InvalidSavedContentIdError: class extends Error {},
}));
vi.mock('@/model/Attachment', () => ({ default: h.createAttachment }));
vi.mock('@/mount-root', () => ({ mountRoot: vi.fn() }));
vi.mock('@/components/DiagramPortal.vue', () => ({ default: {} }));
vi.mock('@/forge-graph-viewer', () => ({ default: Promise.resolve() }));
vi.mock('@/features/feedback/mountFeedback', () => ({ installFeedbackHost: vi.fn() }));
vi.mock('@/utils/byline/revealDiagram', () => ({
  claimReveal: vi.fn(() => null),
  revealThisMacro: vi.fn(),
  followThisMacro: vi.fn(),
}));
vi.mock('@/EventBus', () => ({
  default: { $on: vi.fn(), $emit: vi.fn() },
}));

// Import forgeIndex fresh and return its registered Publish handler.
async function loadSaveHandler(): Promise<() => Promise<void>> {
  const { default: initialized } = await import('@/forgeIndex');
  await initialized;
  const { default: EventBus } = await import('@/EventBus');
  const call = vi.mocked(EventBus.$on).mock.calls.find(([name]) => name === 'save');
  if (!call) throw new Error("forgeIndex did not register a 'save' handler");
  return call[1] as () => Promise<void>;
}

// Let the handler's fire-and-forget close path (the inner async IIFE) finish.
async function flushClosePath() {
  await vi.advanceTimersByTimeAsync(0);
}

const emitted = async () => {
  const { default: EventBus } = await import('@/EventBus');
  return vi.mocked(EventBus.$emit).mock.calls.map(([name]) => name);
};

// The first fresh import of forgeIndex transforms a large module graph and can
// exceed the 5 s default on a cold cache.
describe('forgeIndex Publish handler — draft commit signal', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    h.saveToPlatform.mockResolvedValue('42');
    h.isInserting.mockResolvedValue(false);
    h.isConfiguring.mockResolvedValue(false);
    h.createAttachment.mockResolvedValue(undefined);
    const { default: store } = await import('@/model/store2');
    store.state.diagram.diagramType = 'graph' as any;
    store.state.diagram.id = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits publish-committing before view.close, even when close never settles', async () => {
    let committedBeforeClose: boolean | undefined;
    h.view.close.mockImplementation(async () => {
      committedBeforeClose = (await emitted()).includes('publish-committing');
      return new Promise(() => {}); // the iframe is gone; nothing after this runs
    });
    const save = await loadSaveHandler();

    await save();
    await flushClosePath();

    expect(h.view.close).toHaveBeenCalled();
    expect(committedBeforeClose).toBe(true);
    expect(await emitted()).not.toContain('saved');
  });

  it('emits publish-committing before view.submit on a first bind', async () => {
    h.isInserting.mockResolvedValue(true);
    let committedBeforeSubmit: boolean | undefined;
    h.view.submit.mockImplementation(async () => {
      committedBeforeSubmit = (await emitted()).includes('publish-committing');
      return new Promise(() => {});
    });
    const save = await loadSaveHandler();

    await save();
    await flushClosePath();

    expect(h.view.submit).toHaveBeenCalled();
    expect(committedBeforeSubmit).toBe(true);
  });

  it('follows a failed view.submit with publish-commit-failed, not saved', async () => {
    h.isInserting.mockResolvedValue(true);
    h.view.submit.mockRejectedValue(new Error('MACRO_NOT_FOUND'));
    const save = await loadSaveHandler();

    await save();
    await flushClosePath();

    const names = await emitted();
    expect(names).toContain('publish-committing');
    expect(names.indexOf('publish-commit-failed')).toBeGreaterThan(names.indexOf('publish-committing'));
    expect(names).not.toContain('saved');
  });
});
