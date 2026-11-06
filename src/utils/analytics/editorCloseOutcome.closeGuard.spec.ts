import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  callback: undefined as (() => Promise<void>) | undefined,
  onClose: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(async () => {}),
}));

// Model a host that holds only the last onClose callback. The application must
// install one bridge callback, then fan out locally to draft and telemetry.
vi.mock('@forge/bridge', () => ({ view: { onClose: bridge.onClose } }));
vi.mock('./trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: bridge.trackAnalyticsEvent,
  trackAnalyticsEventBeforeUnload: bridge.trackAnalyticsEventBeforeUnload,
}));
vi.mock('./editorMutationTelemetry', () => ({ getEditorMutationSummary: () => ({}) }));

let setupCloseGuard: typeof import('@/utils/closeGuard').setupCloseGuard;
let closeOutcome: typeof import('./editorCloseOutcome');

beforeEach(async () => {
  vi.resetModules();
  bridge.callback = undefined;
  bridge.onClose.mockReset().mockImplementation(async (callback: () => Promise<void>) => {
    bridge.callback = callback;
  });
  bridge.trackAnalyticsEvent.mockClear();
  bridge.trackAnalyticsEventBeforeUnload.mockClear();
  ({ setupCloseGuard } = await import('@/utils/closeGuard'));
  closeOutcome = await import('./editorCloseOutcome');
});

describe('OpenAPI close tracking with the real close guard', () => {
  const registerCreate = () => closeOutcome.registerEditorCloseTracking({
    getMacroType: () => 'openapi',
    operationMode: 'create',
    hadChanges: () => false,
  });

  it('emits one untouched create cancellation when the draft guard registers later', async () => {
    registerCreate();
    closeOutcome.markEditorAuthoringStarted();
    const flushDraft = vi.fn();
    setupCloseGuard(flushDraft);

    expect(bridge.onClose).toHaveBeenCalledTimes(1);
    await bridge.callback!();

    expect(flushDraft).toHaveBeenCalledTimes(1);
    expect(bridge.trackAnalyticsEventBeforeUnload).toHaveBeenCalledTimes(1);
    expect(bridge.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
      'macro_create_cancelled',
      expect.objectContaining({
        macro_type: 'openapi',
        operation_mode: 'create',
        close_source: 'host_close',
        had_changes: false,
      }),
    );
  });

  it.each(['saved', 'not armed'])('keeps %s sessions quiet while flushing the draft', async (state) => {
    registerCreate();
    if (state === 'saved') {
      closeOutcome.markEditorAuthoringStarted();
      closeOutcome.markEditorSaved();
    }
    const flushDraft = vi.fn();
    setupCloseGuard(flushDraft);

    await bridge.callback!();

    expect(flushDraft).toHaveBeenCalledTimes(1);
    expect(bridge.trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });
});
