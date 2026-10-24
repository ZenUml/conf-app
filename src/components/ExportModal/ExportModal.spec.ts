import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import ExportModal from './ExportModal.vue';
import { writeExportSession } from './exportSession';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function mountModal(visible = true) {
  return mount(ExportModal, {
    props: { visible, diagramTitle: 'Demo' },
    attachTo: document.body,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  writeExportSession(null);
});

describe('ExportModal — dialog semantics', () => {
  it('marks the shell as a labelled export dialog with its toolbar', () => {
    const wrapper = mountModal();
    const dialog = wrapper.find('.export-modal');
    expect(dialog.attributes('role')).toBe('dialog');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-label')).toBe('Export image');
    expect(dialog.attributes('tabindex')).toBe('-1');
    expect(wrapper.find('[role="toolbar"]').attributes('aria-label')).toBe('Export tools');
    wrapper.unmount();
  });
});

describe('ExportModal — current visit session', () => {
  it('restores completed annotations and one watermark after remounting', () => {
    const first = mountModal();
    const item = first.vm.state.annotations.add('note', { x: 0.3, y: 0.4 });
    first.vm.state.annotations.update(item.id, { text: 'Keep this label' });
    first.vm.state.watermarkVisible.value = true;
    first.unmount();
    const reopened = mountModal();
    expect(reopened.vm.state.annotations.items.value.map(item => item.text)).toEqual(['Keep this label']);
    expect(reopened.vm.state.watermarkVisible.value).toBe(true);
    reopened.unmount();
  });
});

describe('ExportModal — Escape layering', () => {
  it('closes the modal when nothing is active', async () => {
    const wrapper = mountModal();
    await wrapper.find('.export-modal').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('exits note editing first without closing', async () => {
    const wrapper = mountModal();
    wrapper.vm.state.noteEditing.value = true;
    await wrapper.find('.export-modal').trigger('keydown', { key: 'Escape' });
    expect(wrapper.vm.state.noteEditing.value).toBe(false);
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('clears an active tool without closing', async () => {
    const wrapper = mountModal();
    wrapper.vm.state.activeTool.value = 'arrow';
    await wrapper.find('.export-modal').trigger('keydown', { key: 'Escape' });
    expect(wrapper.vm.state.activeTool.value).toBe(null);
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('clears a selected annotation without closing', async () => {
    const wrapper = mountModal();
    wrapper.vm.state.selectedAnnotation.value = 'callout';
    await wrapper.find('.export-modal').trigger('keydown', { key: 'Escape' });
    expect(wrapper.vm.state.selectedAnnotation.value).toBe(null);
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('returns focus to the dialog when Escape removes a selected properties toolbar', async () => {
    const wrapper = mountModal();
    const item = wrapper.vm.state.annotations.add('callout', { x: 0.4, y: 0.4 });
    wrapper.vm.state.annotations.update(item.id, { text: 'Retry happens here' });
    wrapper.vm.state.annotations.select(item.id);
    await nextTick();

    const trigger = wrapper.find('button[aria-label="Download image"]');
    (trigger.element as HTMLButtonElement).focus();
    await trigger.trigger('keydown', { key: 'Escape' });

    expect(wrapper.vm.state.annotations.selected.value).toBe(null);
    expect(wrapper.vm.state.annotations.items.value).toHaveLength(1);
    expect(document.activeElement).toBe(wrapper.find('.export-modal').element);

    await wrapper.find('.export-modal').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('ExportModal — focus management', () => {
  it('moves focus into the dialog on open and restores it on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const wrapper = mountModal(false);
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.find('.export-modal').element);

    await wrapper.setProps({ visible: false });
    await flushPromises();
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});

describe('ExportModal — focus trap', () => {
  it('wraps forward from the last focusable to the first', async () => {
    const wrapper = mountModal();
    await nextTick();
    const focusable = Array.from(
      wrapper.find('.export-modal').element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    await wrapper.find('.export-modal').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    wrapper.unmount();
  });

  it('wraps backward from the first focusable to the last', async () => {
    const wrapper = mountModal();
    await nextTick();
    const focusable = Array.from(
      wrapper.find('.export-modal').element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    await wrapper.find('.export-modal').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    wrapper.unmount();
  });
});
