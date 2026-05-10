// TDD spec for the "editor loads underneath the paywall modal" UX change.
//
// Today the page-editor paywall gate replaces the editor entirely — the
// fullscreen Forge iframe shows the modal on a blank background and the
// editor only mounts after the user clicks "Continue editing". This spec
// pins the proposed behaviour: mount Workspace immediately, render the
// modal as an overlay on top, and keep Workspace mounted when the modal
// is dismissed.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PageEditorPaywallGate from '@/components/UpgradePrompt/PageEditorPaywallGate.vue';

const editorStub = {
  name: 'EditorStub',
  template: '<div data-testid="workspace-mounted" />',
};

const baseProps = {
  macrosCreated: 105,
  macrosLimit: 100,
  upgradeUrl: 'https://marketplace.example/upgrade',
  enterpriseBundleUrl: 'https://stripe.example/bundle',
  editor: editorStub,
};

const stubs = {
  UpgradePrompt: {
    name: 'UpgradePrompt',
    props: ['visible'],
    emits: ['close', 'continueEditing'],
    template: `
      <div v-if="visible" data-testid="upgrade-prompt-mounted">
        <button data-testid="continue" @click="$emit('continueEditing')">continue</button>
        <button data-testid="close" @click="$emit('close')">close</button>
      </div>
    `,
  },
};

describe('PageEditorPaywallGate — editor underneath the paywall modal', () => {
  it('mounts the editor (Workspace) alongside the upgrade modal so the iframe is not empty', () => {
    const wrapper = mount(PageEditorPaywallGate, {
      props: baseProps,
      global: { stubs },
    });

    // Both must be present at first paint — the modal sits on top of the editor.
    expect(wrapper.find('[data-testid="workspace-mounted"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="upgrade-prompt-mounted"]').exists()).toBe(true);
  });

  it('hides only the modal when continue-editing fires; the editor stays mounted', async () => {
    const wrapper = mount(PageEditorPaywallGate, {
      props: baseProps,
      global: { stubs },
    });

    await wrapper.get('[data-testid="continue"]').trigger('click');

    expect(wrapper.find('[data-testid="upgrade-prompt-mounted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="workspace-mounted"]').exists()).toBe(true);
    // Continue-editing still bubbles to the parent for tracking / side-effects.
    expect(wrapper.emitted('continue-editing')).toBeTruthy();
  });

  it('hides the modal but keeps the editor when the modal emits close', async () => {
    const wrapper = mount(PageEditorPaywallGate, {
      props: baseProps,
      global: { stubs },
    });

    await wrapper.get('[data-testid="close"]').trigger('click');

    expect(wrapper.find('[data-testid="upgrade-prompt-mounted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="workspace-mounted"]').exists()).toBe(true);
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
