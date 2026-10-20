import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// conf-app#519: 46 Embed macro_create_started in 30 days, zero
// macro_create_succeeded / macro_save_succeeded. These tests drive the real
// editor entry (forge-embed-editor.ts): it is imported, mounted through a
// mocked mountRoot, and the saveEmbedAndExit prop it hands the Vue shell is
// invoked exactly as ForgeEmbedEditor.vue does on the `save-embed` event.

const h = vi.hoisted(() => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(),
  trackEvent: vi.fn(),
  mountRoot: vi.fn(),
  markEditorSaved: vi.fn(),
  markEditorAuthoringStarted: vi.fn(),
  registerEditorCloseTracking: vi.fn(),
  markCsatPending: vi.fn(),
  getMacroData: vi.fn(),
  isFetchable: vi.fn(),
  view: { close: vi.fn(), submit: vi.fn() },
  context: {} as any,
  order: [] as string[],
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getMacroData: h.getMacroData,
      getCustomContentByIdV2: vi.fn(async () => undefined),
      findLegacyCustomContentByUuid: vi.fn(async () => undefined),
      isCustomContentFetchableV2: h.isFetchable,
    },
  },
}));
vi.mock('./model/globals/forgeGlobal', () => ({
  default: { forgeContext: { localId: 'macro-1' } },
  getContext: vi.fn(async () => h.context),
  getView: vi.fn(async () => h.view),
}));
vi.mock('@/utils/window', () => ({ trackEvent: h.trackEvent }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
  trackAnalyticsEventBeforeUnload: h.trackAnalyticsEventBeforeUnload,
}));
vi.mock('@/utils/analytics/publishTiming', () => ({
  markPublishClicked: vi.fn(),
  trackPublishCompleted: vi.fn(),
}));
vi.mock('@/utils/csat', () => ({ markCsatPending: h.markCsatPending }));
vi.mock('@/mount-root', () => ({ mountRoot: h.mountRoot }));
vi.mock('@/utils/restoreDraftBanner', () => ({ installRestoreDraftBanner: vi.fn() }));
vi.mock('@/components/DrawIoExtension/ForgeEmbedEditor.vue', () => ({ default: {} }));
vi.mock('@/utils/journeyTracking', () => ({
  startEditJourney: vi.fn(),
  endEditJourney: vi.fn(),
  getOrCreateSession: vi.fn(),
  getEditJourneyId: vi.fn(() => undefined),
  continueEditJourney: vi.fn(),
  setEditJourneyMeta: vi.fn(),
}));
vi.mock('@/utils/paywall/mountPaywallGate', () => ({ tryPageEditorPaywall: vi.fn(async () => false) }));
vi.mock('@/utils/paywall/warningBanner', () => ({ markRecentMacroActivity: vi.fn() }));
vi.mock('@/utils/analytics/editorCloseOutcome', () => ({
  markEditorAuthoringStarted: h.markEditorAuthoringStarted,
  markEditorSaved: h.markEditorSaved,
  registerEditorCloseTracking: h.registerEditorCloseTracking,
}));
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }));
vi.mock('@/utils/uuid', () => ({ default: () => 'generated-uuid' }));

async function openEditor(context: any) {
  h.context = context;
  vi.resetModules();
  await import('./forge-embed-editor');
  // Let initializeMacro() (async) reach mountRoot + the start event.
  await vi.waitFor(() => expect(h.mountRoot).toHaveBeenCalled());
  const props = h.mountRoot.mock.calls[0][2] as { saveEmbedAndExit: (id: string) => Promise<void>; exit: () => Promise<void> };
  return props;
}

const eventsNamed = (mock: ReturnType<typeof vi.fn>, name: string) =>
  mock.mock.calls.filter(([n]) => n === name);
const allEvents = (name: string) => [
  ...eventsNamed(h.trackAnalyticsEvent, name),
  ...eventsNamed(h.trackAnalyticsEventBeforeUnload, name),
];

const newInsertContext = {
  extension: { type: 'confluence:macro', config: {}, macro: { isInserting: true }, content: { id: 'page-1' } },
};
const existingContext = {
  extension: {
    type: 'confluence:macro',
    config: { customContentId: '12345', uuid: 'cfg-uuid' },
    content: { id: 'page-1' },
  },
};

describe('forge-embed-editor analytics (#519)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const m of [
      h.trackAnalyticsEvent, h.trackAnalyticsEventBeforeUnload, h.trackEvent, h.mountRoot,
      h.markEditorSaved, h.markEditorAuthoringStarted, h.registerEditorCloseTracking,
      h.markCsatPending, h.getMacroData, h.isFetchable, h.view.close, h.view.submit,
    ]) m.mockReset();
    h.trackAnalyticsEventBeforeUnload.mockResolvedValue(undefined);
    h.isFetchable.mockResolvedValue(true);
    h.view.submit.mockResolvedValue(undefined);
    h.getMacroData.mockResolvedValue({});
    h.order.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function save(props: { saveEmbedAndExit: (id: string) => Promise<void> }, id = '777') {
    await props.saveEmbedAndExit(id);
    await vi.advanceTimersByTimeAsync(600);
  }

  it('new insert: exactly one create_started and one create_succeeded, both operation_mode create', async () => {
    const props = await openEditor(newInsertContext);
    await save(props);

    expect(allEvents('macro_create_started')).toHaveLength(1);
    expect(allEvents('macro_create_succeeded')).toHaveLength(1);
    expect(allEvents('macro_save_succeeded')).toHaveLength(0);
    expect(allEvents('macro_edit_started')).toHaveLength(0);
    const succeeded = allEvents('macro_create_succeeded')[0][1];
    expect(succeeded).toMatchObject({ macro_type: 'embed', operation_mode: 'create', custom_content_id: '777' });
    expect(allEvents('macro_create_started')[0][1]).toMatchObject({ macro_type: 'embed', operation_mode: 'create' });
  });

  it('new insert whose macro data already carries a uuid is still a create (discriminator is decided at open)', async () => {
    h.getMacroData.mockResolvedValue({ uuid: 'uuid-captured-at-insert' });
    const props = await openEditor(newInsertContext);
    await save(props);

    expect(allEvents('macro_create_succeeded')).toHaveLength(1);
    expect(allEvents('macro_save_succeeded')).toHaveLength(0);
  });

  it('existing embed without a config uuid: edit_started then save_succeeded (not a create)', async () => {
    h.getMacroData.mockResolvedValue({ customContentId: '12345' });
    const props = await openEditor({
      extension: { type: 'confluence:macro', config: { customContentId: '12345' }, content: { id: 'page-1' } },
    });
    await save(props);

    expect(allEvents('macro_edit_started')).toHaveLength(1);
    expect(allEvents('macro_save_succeeded')).toHaveLength(1);
    expect(allEvents('macro_create_succeeded')).toHaveLength(0);
    expect(allEvents('macro_save_succeeded')[0][1]).toMatchObject({ operation_mode: 'edit', custom_content_id: '777' });
    expect(allEvents('macro_edit_started')[0][1]).toMatchObject({ operation_mode: 'edit', custom_content_id: '12345' });
    expect(h.markCsatPending).toHaveBeenCalledTimes(1);
  });

  it('copied macro (config id and uuid present, as after a page copy) is an edit', async () => {
    h.getMacroData.mockResolvedValue({ customContentId: '12345', uuid: 'cfg-uuid' });
    const props = await openEditor(existingContext);
    await save(props);

    expect(allEvents('macro_edit_started')).toHaveLength(1);
    expect(allEvents('macro_save_succeeded')).toHaveLength(1);
    expect(allEvents('macro_create_succeeded')).toHaveLength(0);
  });

  it('missing or late macro data does not change the mode decided at open', async () => {
    h.getMacroData.mockResolvedValue(undefined);
    const props = await openEditor(existingContext);
    await save(props);
    expect(allEvents('macro_save_succeeded')).toHaveLength(1);
    expect(allEvents('macro_create_succeeded')).toHaveLength(0);
  });

  it('waits for the success event to be delivered before view.submit tears the iframe down', async () => {
    let release!: () => void;
    h.trackAnalyticsEventBeforeUnload.mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const props = await openEditor(newInsertContext);
    await props.saveEmbedAndExit('777');
    await vi.advanceTimersByTimeAsync(600);

    expect(allEvents('macro_create_succeeded')).toHaveLength(1);
    expect(h.view.submit).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.view.submit).toHaveBeenCalledTimes(1);
  });

  it('a target that is not fetchable keeps the editor open and reports no success', async () => {
    h.isFetchable.mockResolvedValue(false);
    const props = await openEditor(newInsertContext);
    await save(props);

    expect(allEvents('macro_create_succeeded')).toHaveLength(0);
    expect(allEvents('macro_save_succeeded')).toHaveLength(0);
    expect(h.markEditorSaved).not.toHaveBeenCalled();
    expect(h.view.submit).not.toHaveBeenCalled();
  });

  it('an invalid picked id reports no success', async () => {
    const props = await openEditor(newInsertContext);
    await save(props, 'undefined');

    expect(allEvents('macro_create_succeeded')).toHaveLength(0);
    expect(h.view.submit).not.toHaveBeenCalled();
  });

  it('cancelled (exit without save) emits no success event', async () => {
    const props = await openEditor(newInsertContext);
    await props.exit();

    expect(allEvents('macro_create_started')).toHaveLength(1);
    expect(allEvents('macro_create_succeeded')).toHaveLength(0);
    expect(allEvents('macro_save_succeeded')).toHaveLength(0);
    expect(h.view.close).toHaveBeenCalled();
  });

  it('marks the editor saved only once the save is going to be submitted', async () => {
    const props = await openEditor(newInsertContext);
    await props.saveEmbedAndExit('777');
    expect(h.markEditorSaved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(h.markEditorSaved).toHaveBeenCalledTimes(1);
  });
});
