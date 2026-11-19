import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';

const exportDiagram = vi.fn();
vi.mock('./useExportEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useExportEngine')>()),
  useExportEngine: () => ({ exportDiagram, exportDiagramToClipboard: vi.fn() }),
}));
vi.mock('@/model/captureBlob', () => ({ captureBlob: vi.fn(async () => null), default: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

import ExportModal from './ExportModal.vue';
import { captureBlob } from '@/model/captureBlob';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function mountGraphModal() {
  const node = document.createElement('div');
  node.className = 'screen-capture-content';
  document.body.appendChild(node);
  return mount(ExportModal, {
    props: { visible: false, diagramTitle: 'Demo', macroType: 'graph', captureNodeGetter: () => node },
    attachTo: document.body,
  });
}

describe('ExportModal — images the iframe cannot fetch', () => {
  it('asks the preview capture to blank unloadable images', async () => {
    const wrapper = mountGraphModal();
    await wrapper.setProps({ visible: true });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));

    expect(captureBlob).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ skipUnloadableImages: true }));
    wrapper.unmount();
  });

  it('records skipped_image_count on export_png_succeeded when the export blanked images', async () => {
    exportDiagram.mockResolvedValue({ ok: true, skippedImageCount: 1 });
    const wrapper = mountGraphModal();
    await wrapper.setProps({ visible: true });
    await nextTick();

    await (wrapper.vm as unknown as { handleExport: () => Promise<void> }).handleExport();

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('export_png_succeeded', expect.objectContaining({ skipped_image_count: 1 }));
    wrapper.unmount();
  });
});
