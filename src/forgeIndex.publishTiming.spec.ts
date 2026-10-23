import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The sequence-family Publish handler registered by forgeIndex.ts on the
// EventBus 'save' event. These tests drive that real handler and read the
// macro_publish_completed event it emits, to pin the per-step timings the
// handler itself owns: attachment_ack_ms, attachment_timed_out and
// writeback_context_ms. (snapshot_ms / mirror_sync_ms live in Persistence and
// attachment_capture_ms in Attachment; each has its own spec.)

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
}));
vi.mock('@/EventBus', () => ({
  default: { $on: vi.fn(), $emit: vi.fn() },
}));

const ATTACHMENT_CAP_MS = 6000;

// A stand-in for the PNG backup that takes `ms` to settle, then resolves or
// rejects. Uses the fake timers, so tests move time with advanceTimersByTimeAsync.
const backupTaking = (ms: number, outcome: 'ok' | 'error' = 'ok') => () =>
  new Promise<void>((resolve, reject) =>
    setTimeout(() => (outcome === 'ok' ? resolve() : reject(new Error('toPng failed'))), ms),
  );

// Run the Publish handler while `ms` of fake time passes, then let the
// fire-and-forget close path finish.
async function publishOver(save: () => Promise<void>, ms: number) {
  const saving = save();
  await vi.advanceTimersByTimeAsync(ms);
  await saving;
  await flushClosePath();
}

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

const publishEvent = () =>
  h.trackAnalyticsEvent.mock.calls.find(([name]) => name === 'macro_publish_completed')?.[1] as
    | Record<string, unknown>
    | undefined;

describe('forgeIndex Publish handler — per-step publish timing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    // One clock for everything: the fake timers' Date, so a timer that fires
    // after N ms also moves performance.now() by N ms.
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    localStorage.clear();
    sessionStorage.clear();
    h.saveToPlatform.mockResolvedValue('42');
    h.isInserting.mockResolvedValue(false);
    h.isConfiguring.mockResolvedValue(false);
    h.view.close.mockResolvedValue(undefined);
    h.view.submit.mockResolvedValue(undefined);
    h.createAttachment.mockResolvedValue(undefined);
    const { default: store } = await import('@/model/store2');
    store.state.diagram.diagramType = 'mermaid' as any;
    store.state.diagram.id = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports the attachment backup time and that the cap did not fire when it finishes first', async () => {
    h.createAttachment.mockImplementation(backupTaking(2200));
    const save = await loadSaveHandler();

    await publishOver(save, 2200);

    expect(publishEvent()).toMatchObject({ attachment_ack_ms: 2200, attachment_timed_out: false });
  });

  it('reports attachment_timed_out when the 6000 ms cap wins the race', async () => {
    // A capture that never settles.
    h.createAttachment.mockImplementation(() => new Promise(() => {}));
    const save = await loadSaveHandler();

    await publishOver(save, ATTACHMENT_CAP_MS);

    expect(publishEvent()).toMatchObject({ attachment_ack_ms: ATTACHMENT_CAP_MS, attachment_timed_out: true });
  });

  it('does not report a timeout for a backup that failed fast: the race settled before the cap', async () => {
    h.createAttachment.mockImplementation(backupTaking(300, 'error'));
    const save = await loadSaveHandler();

    await publishOver(save, 300);

    expect(publishEvent()).toMatchObject({ attachment_ack_ms: 300, attachment_timed_out: false });
    // The cap timer is cleared once the race settles (#952), so nothing fires
    // later; even if it did, it must not change what was reported.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(ATTACHMENT_CAP_MS);
    expect(h.trackAnalyticsEvent.mock.calls.filter(([n]) => n === 'macro_publish_completed')).toHaveLength(1);
  });

  it('omits the attachment properties when no backup is attempted (non-sequence-family type)', async () => {
    const { default: store } = await import('@/model/store2');
    store.state.diagram.diagramType = 'graph' as any;
    const save = await loadSaveHandler();

    await save();
    await flushClosePath();

    const props = publishEvent();
    expect(props).toBeDefined();
    expect(props).not.toHaveProperty('attachment_ack_ms');
    expect(props).not.toHaveProperty('attachment_timed_out');
    expect(h.createAttachment).not.toHaveBeenCalled();
  });

  it('reports how long the writeback context lookup took, 0 included', async () => {
    const save = await loadSaveHandler();

    await save();
    await flushClosePath();

    expect(publishEvent()).toHaveProperty('writeback_context_ms', 0);
  });

  it('does not change the close path: the redirect still waits for the backup and runs after the event', async () => {
    const order: string[] = [];
    h.createAttachment.mockImplementation(async () => { order.push('attachment'); });
    h.trackAnalyticsEvent.mockImplementation((name: string) => {
      if (name === 'macro_publish_completed') order.push('publish_completed');
    });
    h.view.submit.mockImplementation(async () => { order.push('redirect'); });
    h.view.close.mockImplementation(async () => { order.push('redirect'); });
    const save = await loadSaveHandler();

    await save();
    await flushClosePath();

    expect(order).toEqual(['attachment', 'publish_completed', 'redirect']);
  });
});
