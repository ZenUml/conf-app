import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BasePromptModal from '@/components/UpgradePrompt/BasePromptModal.vue';

describe('BasePromptModal', () => {
  it('renders title and body slots when visible', () => {
    const wrapper = mount(BasePromptModal, {
      props: { visible: true },
      slots: { title: 'Hello', default: '<p>Body</p>' },
      attachTo: document.body,
    });
    expect(document.body.textContent).toContain('Hello');
    expect(document.body.textContent).toContain('Body');
    wrapper.unmount();
  });

  it('does not render when visible=false', () => {
    mount(BasePromptModal, { props: { visible: false }, slots: { title: 'X' } });
    expect(document.body.textContent).not.toContain('X');
  });

  it('emits close on backdrop click', async () => {
    const wrapper = mount(BasePromptModal, { props: { visible: true }, attachTo: document.body });
    const backdrop = document.querySelector('.bg-black.bg-opacity-50') as HTMLElement;
    backdrop.click();
    expect(wrapper.emitted('close')).toBeTruthy();
    wrapper.unmount();
  });
});
