import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  context: {} as any,
  copied: false,
  mountedProps: undefined as any,
  getMacroData: vi.fn(async () => undefined as any),
  submitted: vi.fn(async () => undefined),
  closed: vi.fn(async () => undefined),
  events: [] as Array<[string, Record<string, unknown>]>,
  unloadEvents: [] as Array<[string, Record<string, unknown>]>,
  publishRequested: vi.fn(),
  publishCompleted: vi.fn(),
  markEditorSaved: vi.fn(),
  markRecentMacroActivity: vi.fn(),
  markCsatPending: vi.fn(),
  registerEditorCloseTracking: vi.fn(),
  closeOffs: [] as ReturnType<typeof vi.fn>[],
  eventBusEmit: vi.fn(),
}));

vi.mock('@/utils/restoreDraftBanner', () => ({ installRestoreDraftBanner: vi.fn() }));
vi.mock('@/components/DrawIoExtension/ForgeEmbedEditor.vue', () => ({ default: {} }));
vi.mock('@/mount-root', () => ({
  mountRoot: vi.fn((_doc, _component, props) => { h.mountedProps = props; }),
}));
vi.mock('@/utils/paywall/mountPaywallGate', () => ({ tryPageEditorPaywall: vi.fn(async () => false) }));
vi.mock('@/model/store2', () => ({ default: { state: { diagram: {} } } }));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getMacroData: () => h.getMacroData(),
      getCustomContentByIdV2: vi.fn(async (id: string) => ({
        id,
        value: { id, diagramType: 'embed', title: 'Example target', isCopy: h.copied },
      })),
      findLegacyCustomContentByUuid: vi.fn(async () => undefined),
      isCustomContentFetchableV2: vi.fn(async () => true),
    },
  },
}));
vi.mock('./model/globals/forgeGlobal', () => ({
  default: { isForge: true, get forgeContext() { return h.context; } },
  getContext: vi.fn(async () => h.context),
  getView: vi.fn(async () => ({ submit: h.submitted, close: h.closed })),
}));
vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn((name: string, props: Record<string, unknown>) => h.events.push([name, props])),
  trackAnalyticsEventBeforeUnload: vi.fn(async (name: string, props: Record<string, unknown>) => {
    h.unloadEvents.push([name, props]);
  }),
}));
vi.mock('@/utils/analytics/publishIntent', () => ({
  trackPublishRequested: (...args: unknown[]) => h.publishRequested(...args),
}));
vi.mock('@/utils/analytics/publishTiming', () => ({
  markPublishClicked: vi.fn(),
  trackPublishCompleted: (...args: unknown[]) => h.publishCompleted(...args),
}));
vi.mock('@/utils/csat', () => ({ markCsatPending: () => h.markCsatPending() }));
vi.mock('@/utils/paywall/warningBanner', () => ({
  markRecentMacroActivity: (...args: unknown[]) => h.markRecentMacroActivity(...args),
}));
vi.mock('@/utils/journeyTracking', () => ({
  startEditJourney: vi.fn(), endEditJourney: vi.fn(), getOrCreateSession: vi.fn(),
  getEditJourneyId: vi.fn(() => undefined), continueEditJourney: vi.fn(),
}));
vi.mock('@/utils/analytics/editorCloseOutcome', () => ({
  markEditorAuthoringStarted: vi.fn(),
  markEditorSaved: () => h.markEditorSaved(),
  registerEditorCloseTracking: (config: unknown) => {
    h.registerEditorCloseTracking(config);
    const off = vi.fn();
    h.closeOffs.push(off);
    return off;
  },
}));
vi.mock('./EventBus', () => ({ default: { $emit: (...args: unknown[]) => h.eventBusEmit(...args) } }));

async function openEditor({
  customContentId,
  uuid,
  localId = 'macro-local-id',
  copied = false,
  lateMacroData,
}: {
  customContentId?: string;
  uuid?: string;
  localId?: string;
  copied?: boolean;
  lateMacroData?: Record<string, unknown>;
}) {
  h.context = {
    localId,
    moduleKey: 'zenuml-embed-macro',
    extension: {
      config: { customContentId, uuid },
      content: { id: 'example-page' },
      macro: { isConfiguring: !!customContentId, isInserting: !customContentId },
    },
  };
  h.copied = copied;
  h.getMacroData.mockResolvedValue(lateMacroData);
  const module = await import('./forge-embed-editor');
  await module.default;
  return h.mountedProps.saveEmbedAndExit as (id: string) => Promise<void>;
}

function lifecycle(name: string) {
  return [...h.events, ...h.unloadEvents].filter(([event]) => event === name);
}

async function publish(save: (id: string) => Promise<void>, id = 'target-123') {
  await save(id);
  await vi.advanceTimersByTimeAsync(500);
}

describe('Embed authoring lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    h.context = {};
    h.copied = false;
    h.mountedProps = undefined;
    h.events.length = 0;
    h.unloadEvents.length = 0;
    h.closeOffs.length = 0;
    h.submitted.mockResolvedValue(undefined);
  });

  it.each([
    ['new', {}, { uuid: 'late-uuid' }, 'macro_create_started', 'macro_create_succeeded', 'create'],
    ['existing', { customContentId: 'source-123', uuid: 'existing-uuid' }, undefined, 'macro_edit_started', 'macro_save_succeeded', 'edit'],
    ['copied', { customContentId: 'source-123' }, undefined, 'macro_edit_started', 'macro_save_succeeded', 'edit'],
  ] as const)(
    'keeps one %s operation mode when macro data changes after open',
    async (_label, initial, late, startedEvent, succeededEvent, operationMode) => {
      const save = await openEditor({ ...initial, copied: _label === 'copied', lateMacroData: late });
      await publish(save);

      expect(lifecycle(startedEvent)).toEqual([[startedEvent, expect.objectContaining({
        macro_uuid: 'macro-local-id', operation_mode: operationMode,
      })]]);
      expect(lifecycle(succeededEvent)).toEqual([[succeededEvent, expect.objectContaining({
        macro_type: 'embed', macro_uuid: 'macro-local-id', operation_mode: operationMode,
      })]]);
      expect(h.publishRequested).toHaveBeenCalledWith(expect.objectContaining({ operationMode }));
      expect(h.publishCompleted).toHaveBeenCalledWith(expect.objectContaining({ operation_mode: operationMode }));
      expect(h.getMacroData).not.toHaveBeenCalled();
    },
  );

  it('reports success only after submit resolves and uses the unload-safe analytics path', async () => {
    let resolveSubmit!: () => void;
    h.submitted.mockReturnValue(new Promise<void>(resolve => { resolveSubmit = resolve; }));
    const save = await openEditor({});

    await save('target-123');
    await vi.advanceTimersByTimeAsync(500);
    expect(lifecycle('macro_create_succeeded')).toHaveLength(0);
    expect(h.markEditorSaved).not.toHaveBeenCalled();
    expect(h.closeOffs[0]).toHaveBeenCalledTimes(1);

    resolveSubmit();
    await vi.runAllTimersAsync();

    expect(h.unloadEvents).toContainEqual(['macro_create_succeeded', expect.objectContaining({ operation_mode: 'create' })]);
    expect(h.markEditorSaved).toHaveBeenCalledTimes(1);
    expect(h.events.find(([name]) => name === 'macro_create_succeeded')).toBeUndefined();
  });

  it('re-arms close tracking and never reports success when submit rejects', async () => {
    h.submitted.mockRejectedValue(new Error('not submittable'));
    const save = await openEditor({ customContentId: 'source-123', uuid: 'existing-uuid' });

    await publish(save);

    expect(lifecycle('macro_save_succeeded')).toHaveLength(0);
    expect(h.markEditorSaved).not.toHaveBeenCalled();
    expect(h.closeOffs[0]).toHaveBeenCalledTimes(1);
    expect(h.registerEditorCloseTracking).toHaveBeenCalledTimes(2);
    expect(h.eventBusEmit).toHaveBeenCalledWith('save-error', expect.any(Error));
    expect(lifecycle('macro_save_failed')).toEqual([['macro_save_failed', expect.objectContaining({
      operation_mode: 'edit', failure_stage: 'writeback', failure_reason: 'view_submit_failed',
    })]]);
  });

  it.each([
    ['invalid target id', 'undefined', true, 'invalid_selected_content_id'],
    ['unfetchable target', 'target-123', false, 'target_not_fetchable'],
  ] as const)('does not report success for an %s', async (_label, id, fetchable, failureReason) => {
    const globals = (await import('@/model/globals')).default;
    vi.mocked(globals.apWrapper.isCustomContentFetchableV2).mockResolvedValue(fetchable);
    const save = await openEditor({});

    await publish(save, id);

    expect(lifecycle('macro_create_succeeded')).toHaveLength(0);
    expect(h.markEditorSaved).not.toHaveBeenCalled();
    expect(lifecycle('macro_save_failed')).toEqual([['macro_save_failed', expect.objectContaining({
      operation_mode: 'create', failure_stage: 'validation', failure_reason: failureReason,
    })]]);
  });
});
