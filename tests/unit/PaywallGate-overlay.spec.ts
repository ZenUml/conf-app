// Pins the "content loads underneath the paywall modal" UX: the wrapped
// component (editor or viewer) mounts immediately, the upgrade modal sits on
// top as an overlay, and dismissing the modal leaves the content visible.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PaywallGate from '@/components/UpgradePrompt/PaywallGate.vue';

const contentStub = {
  name: 'ContentStub',
  template: '<div data-testid="content-mounted" />',
};

const baseProps = {
  macrosCreated: 105,
  macrosLimit: 100,
  upgradeUrl: 'https://marketplace.example/upgrade',
  enterpriseBundleUrl: 'https://stripe.example/bundle',
  content: contentStub,
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

describe('PaywallGate — content underneath the paywall modal', () => {
  it('mounts the content alongside the upgrade modal so the iframe is not empty', () => {
    const wrapper = mount(PaywallGate, {
      props: baseProps,
      global: { stubs },
    });

    expect(wrapper.find('[data-testid="content-mounted"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="upgrade-prompt-mounted"]').exists()).toBe(true);
  });

  it('hides only the modal when continue-editing fires; the content stays mounted', async () => {
    const wrapper = mount(PaywallGate, {
      props: baseProps,
      global: { stubs },
    });

    await wrapper.get('[data-testid="continue"]').trigger('click');

    expect(wrapper.find('[data-testid="upgrade-prompt-mounted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="content-mounted"]').exists()).toBe(true);
    expect(wrapper.emitted('continue-editing')).toBeTruthy();
  });

  it('hides the modal but keeps the content when the modal emits close', async () => {
    const wrapper = mount(PaywallGate, {
      props: baseProps,
      global: { stubs },
    });

    await wrapper.get('[data-testid="close"]').trigger('click');

    expect(wrapper.find('[data-testid="upgrade-prompt-mounted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="content-mounted"]').exists()).toBe(true);
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
