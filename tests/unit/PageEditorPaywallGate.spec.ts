import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PageEditorPaywallGate from '@/components/UpgradePrompt/PageEditorPaywallGate.vue';

describe('PageEditorPaywallGate', () => {
  it('emits continue-editing only on the explicit continue-editing event from the prompt', async () => {
    const wrapper = mount(PageEditorPaywallGate, {
      props: {
        macrosCreated: 100,
        macrosLimit: 100,
        upgradeUrl: 'https://example.com/upgrade',
        enterpriseBundleUrl: 'https://example.com/enterprise',
      },
      global: {
        stubs: {
          UpgradePrompt: {
            template: `
              <div>
                <button data-testid="close" @click="$emit('close')">close</button>
                <button data-testid="continue" @click="$emit('continueEditing')">continue</button>
              </div>
            `,
          },
        },
      },
    });

    // A bare close (Escape, backdrop, ×, upgrade-CTA dismissal) must NOT grant edit access
    await wrapper.get('[data-testid="close"]').trigger('click');
    expect(wrapper.emitted('continue-editing')).toBeFalsy();

    // Only an explicit continueEditing from the prompt unlocks the editor
    await wrapper.get('[data-testid="continue"]').trigger('click');
    expect(wrapper.emitted('continue-editing')).toBeTruthy();
    expect(wrapper.emitted('continue-editing')).toHaveLength(1);
  });
});
