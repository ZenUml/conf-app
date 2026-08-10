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
