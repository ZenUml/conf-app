import { mount, flushPromises } from '@vue/test-utils';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Heavy editor-lifecycle deps are stubbed so the component mounts in jsdom and
// we can exercise the DrawIO export glue in isolation.
vi.mock('@/components/DrawIoExtension/DrawIoExtension.vue', () => ({
  default: { name: 'DrawIoExtension', render: () => null },
}));
vi.mock('@/components/DrawIoExtension/graphEditor.css', () => ({}));
vi.mock('@/utils/draftStore', () => ({
  makeDebouncedDraftSaver: () => ({ save: vi.fn(), flush: vi.fn() }),
  loadDraft: vi.fn().mockResolvedValue(null),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  primeCloudId: vi.fn().mockResolvedValue(undefined),
  getCachedCloudId: vi.fn(() => null),
  saveDraftSync: vi.fn(),
}));
vi.mock('@/utils/closeGuard', () => ({ setupCloseGuard: vi.fn(() => () => {}) }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { isForge: true, forgeContext: {} },
  getView: vi.fn(),
  getContext: vi.fn(),
  isInserting: vi.fn().mockResolvedValue(false),
}));

import ForgeGraphEditor from '@/components/DrawIoExtension/ForgeGraphEditor.vue';
import store from '@/model/store2';

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47];
const PNG_DATA_URI = 'data:image/png;base64,' + btoa(String.fromCharCode(...PNG_BYTES));

function dispatchDrawioMessage(payload: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
}

function mountEditor(saveGraphAndExit = vi.fn().mockResolvedValue(undefined)) {
  const wrapper = mount(ForgeGraphEditor, {
    props: { graphXml: '<mxfile/>', saveGraphAndExit, doc: {}, customContentId: 'cc-1' },
    global: { plugins: [store], stubs: { DrawIoExtension: true } },
  });
  return { wrapper, saveGraphAndExit };
}

describe('ForgeGraphEditor — DrawIO PNG export glue (graph save-time backup)', () => {
  beforeEach(() => {
    (window as any).ensureTitle = vi.fn().mockResolvedValue(undefined);
    delete (window as any).graphXml;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).ensureTitle;
    delete (window as any).graphXml;
  });

  it('dataUriToBlob converts a base64 PNG data URI to an image/png Blob', () => {
    const { wrapper } = mountEditor();
    const blob = (wrapper.vm as any).dataUriToBlob(PNG_DATA_URI);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(PNG_BYTES.length);
  });

  it('exportPng resolves with a Blob when DrawIO returns an export message', async () => {
    const { wrapper } = mountEditor();
    const p = (wrapper.vm as any).exportPng();
    dispatchDrawioMessage({ event: 'export', data: PNG_DATA_URI });
    const blob = await p;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('exportPng resolves null on timeout (never blocks Publish)', async () => {
    vi.useFakeTimers();
    const { wrapper } = mountEditor();
    const p = (wrapper.vm as any).exportPng(2000);
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toBeNull();
  });

  it('the DrawIO "save" message exports a PNG and forwards it to saveGraphAndExit', async () => {
    const { wrapper, saveGraphAndExit } = mountEditor();
    // Isolate the save handoff from the export round-trip.
    const blob = new Blob([new Uint8Array(PNG_BYTES)], { type: 'image/png' });
    (wrapper.vm as any).exportPng = vi.fn().mockResolvedValue(blob);

    dispatchDrawioMessage({ event: 'save', xml: '<mxfile>saved</mxfile>' });
    await flushPromises();

    expect((window as any).ensureTitle).toHaveBeenCalled();
    expect(saveGraphAndExit).toHaveBeenCalledWith('<mxfile>saved</mxfile>', blob);
  });
});
