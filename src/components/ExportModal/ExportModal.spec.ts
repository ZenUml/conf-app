import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import ExportModal from './ExportModal.vue';

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
});

describe('ExportModal — dialog semantics', () => {
  it('marks the shell as a labelled modal dialog pointing at the settings heading', () => {
    const wrapper = mountModal();
    const dialog = wrapper.find('.export-modal');
    expect(dialog.attributes('role')).toBe('dialog');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBe('export-settings-title');
    expect(dialog.attributes('tabindex')).toBe('-1');
    expect(wrapper.find('#export-settings-title').text()).toBe('Export Settings');
    wrapper.unmount();
  });
});

// Named for what these assertions actually cover: the flow/semantics contract.
// That the Forge macro iframe then GROWS is a browser+Forge behaviour jsdom
// cannot exercise — it is verified on staging with measured iframe heights and
// screenshots (see the PR's spot check), per the repo's UI-evidence rule.
describe('ExportModal — inline variant renders in flow, not as a modal overlay', () => {
  // On the inline macro surface the dialog must live IN the document flow.
  // A `position: fixed` overlay contributes no document height, so Forge's
  // automatic iframe resize never sees it and clips the dialog to the macro's
  // own height — 564x256 on production page 2774138946, which leaves the
  // annotation controls in a 24px-tall scroller holding 312px of form.
  it('renders in flow, without modal semantics, when variant is inline', () => {
    const wrapper = mount(ExportModal, {
      props: { visible: true, diagramTitle: 'Demo', variant: 'inline' },
      attachTo: document.body,
    });
    const backdrop = wrapper.find('.export-modal-backdrop');
    expect(backdrop.classes()).toContain('export-modal-backdrop--inline');
    expect(backdrop.classes()).not.toContain('export-modal-backdrop--overlay');
    // aria-modal claims the rest of the page is inert. In flow it is not.
    expect(wrapper.find('.export-modal').attributes('aria-modal')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps the overlay variant as the default, for fullscreen', () => {
    const wrapper = mountModal();
    const backdrop = wrapper.find('.export-modal-backdrop');
    expect(backdrop.classes()).toContain('export-modal-backdrop--overlay');
    expect(wrapper.find('.export-modal').attributes('aria-modal')).toBe('true');
    wrapper.unmount();
  });

  it('does not close the inline panel on a backdrop click, since there is no backdrop', async () => {
    const wrapper = mount(ExportModal, {
      props: { visible: true, diagramTitle: 'Demo', variant: 'inline' },
      attachTo: document.body,
    });
    await wrapper.find('.export-modal-backdrop').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });
});

describe('ExportModal — focus trap follows the variant', () => {
  // A trap is what makes a dialog modal for a keyboard user. The inline panel
  // sits in the page with the viewer's own buttons still live beside it, so
  // trapping there would make the surface modal in behaviour while telling
  // assistive technology it is not.
  it('does not trap Tab in the inline variant', async () => {
    const wrapper = mount(ExportModal, {
      props: { visible: true, diagramTitle: 'Demo', variant: 'inline' },
      attachTo: document.body,
    });
    const dialog = wrapper.find('.export-modal');
    const focusable = dialog.element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const last = focusable[focusable.length - 1];
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.element.dispatchEvent(event);
    // Not prevented => the browser moves focus onward, out of the panel.
    expect(event.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it('still traps Tab in the overlay variant', async () => {
    const wrapper = mountModal();
    const dialog = wrapper.find('.export-modal');
    const focusable = dialog.element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const last = focusable[focusable.length - 1];
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
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
