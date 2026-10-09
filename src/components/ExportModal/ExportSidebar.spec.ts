import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import ExportSidebar from './ExportSidebar.vue';
import { exportStateKey, useExportState } from './useExportState';

function mountSidebar(configureState: (state: ReturnType<typeof useExportState>) => void = () => {}) {
  const state = useExportState();
  configureState(state);
  const wrapper = mount(ExportSidebar, {
    global: { provide: { [exportStateKey]: state } },
  });
  return { wrapper, state };
}

describe('ExportSidebar — Copy image button', () => {
  const originalClipboardItem = (globalThis as any).ClipboardItem;
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    (globalThis as any).ClipboardItem = originalClipboardItem;
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('is hidden when the browser does not support Clipboard image writes', () => {
    delete (globalThis as any).ClipboardItem;
    Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
    const { wrapper } = mountSidebar();
    expect(wrapper.find('.btn-copy').exists()).toBe(false);
  });

  it('is visible and emits copy on click when supported', async () => {
    (globalThis as any).ClipboardItem = class {};
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
    const { wrapper } = mountSidebar();
    const btn = wrapper.find('.btn-copy');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe('Copy image');
    await btn.trigger('click');
    expect(wrapper.emitted('copy')).toHaveLength(1);
  });

  it('shows "Copied" once state.copySucceeded is true, and does not close the modal (no close/export emitted)', () => {
    (globalThis as any).ClipboardItem = class {};
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
    const { wrapper } = mountSidebar((state) => { state.copySucceeded.value = true; });
    expect(wrapper.find('.btn-copy').text()).toBe('Copied');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('disables the button while isCopying or isExporting is true', () => {
    (globalThis as any).ClipboardItem = class {};
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true });
    const { wrapper } = mountSidebar((state) => { state.isCopying.value = true; });
    expect((wrapper.find('.btn-copy').element as HTMLButtonElement).disabled).toBe(true);
    expect(wrapper.find('.btn-copy').text()).toBe('Copying…');
  });
});

describe('ExportSidebar — PDF format fake-door', () => {
  it('hides the format menu until the caret is clicked', () => {
    const { wrapper } = mountSidebar();
    expect(wrapper.find('.export-format-menu').exists()).toBe(false);
  });

  it('opens a menu with PNG and PDF (Soon) options on caret click', async () => {
    const { wrapper } = mountSidebar();
    await wrapper.find('.btn-export-caret').trigger('click');
    const menu = wrapper.find('.export-format-menu');
    expect(menu.exists()).toBe(true);
    expect(menu.text()).toContain('PNG');
    expect(menu.text()).toContain('PDF');
    expect(menu.text()).toContain('Soon');
  });

  it('clicking PNG in the menu closes it without emitting export or close', async () => {
    const { wrapper } = mountSidebar();
    await wrapper.find('.btn-export-caret').trigger('click');
    await wrapper.find('.export-format-option-png').trigger('click');
    expect(wrapper.find('.export-format-menu').exists()).toBe(false);
    expect(wrapper.emitted('export')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('clicking PDF emits pdf-format-clicked (not export/close) and shows an inline note', async () => {
    const { wrapper } = mountSidebar();
    await wrapper.find('.btn-export-caret').trigger('click');
    await wrapper.find('.export-format-option-pdf').trigger('click');
    expect(wrapper.emitted('pdf-format-clicked')).toHaveLength(1);
    expect(wrapper.emitted('export')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.find('.export-format-menu').exists()).toBe(false);
    expect(wrapper.find('.export-format-note').text()).toContain('PDF export isn\'t built yet');
  });
});
