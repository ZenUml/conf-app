import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PaywallGate from '@/components/UpgradePrompt/PaywallGate.vue';
import {
  continueAttemptsKey,
  DEFAULT_CONTINUE_ATTEMPTS,
} from '@/utils/paywall/continueAttempts';

const identity = {
  clientDomain: 'example-tenant',
  spaceKey: 'ENG',
  userAccountId: 'account-123',
};

describe('PaywallGate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('emits continue-editing only on the explicit continue-editing event from the prompt', async () => {
    const onContinueEditing = vi.fn();
    const wrapper = mount(PaywallGate, {
      props: {
        macrosCreated: 100,
        macrosLimit: 100,
        upgradeUrl: 'https://example.com/upgrade',
        enterpriseBundleUrl: 'https://example.com/enterprise',
        content: { template: '<div data-testid="content-stub" />' },
        onContinueEditing,
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

    // A bare close (Escape, backdrop, ×, dismissal) must NOT grant edit access
    await wrapper.get('[data-testid="close"]').trigger('click');
    expect(wrapper.emitted('continue-editing')).toBeFalsy();
    expect(onContinueEditing).not.toHaveBeenCalled();

    // Only an explicit continueEditing from the prompt unlocks the content
    await wrapper.get('[data-testid="continue"]').trigger('click');
    expect(wrapper.emitted('continue-editing')).toBeTruthy();
    expect(wrapper.emitted('continue-editing')).toHaveLength(1);
    expect(onContinueEditing).toHaveBeenCalledOnce();
  });

  it('an unlocked survey grant closes the modal WITHOUT spending a continue attempt', async () => {
    const onContinueEditing = vi.fn();
    const wrapper = mount(PaywallGate, {
      props: {
        macrosCreated: 100,
        macrosLimit: 100,
        upgradeUrl: 'https://example.com/upgrade',
        enterpriseBundleUrl: 'https://example.com/enterprise',
        content: { template: '<div data-testid="content-stub" />' },
        continueAttemptsIdentity: identity,
        onContinueEditing,
      },
      global: {
        stubs: {
          UpgradePrompt: {
            template: `
              <div>
                <button data-testid="unlocked" @click="$emit('unlocked')">unlocked</button>
              </div>
            `,
          },
        },
      },
    });

    await wrapper.get('[data-testid="unlocked"]').trigger('click');

    // Editing resumes on the same channel the editor already listens on...
    expect(wrapper.emitted('continue-editing')).toHaveLength(1);
    expect(onContinueEditing).toHaveBeenCalledOnce();
    // ...but the attempt balance is untouched: the user earned a license, and
    // the counter exists to ration free passes, not paid ones.
    expect(JSON.parse(localStorage.getItem(continueAttemptsKey(identity)) || '{}')).toMatchObject({
      remainingAttempts: DEFAULT_CONTINUE_ATTEMPTS,
      lastUsedAt: null,
    });
  });

  it('initializes local continue attempts and passes the remaining count to the prompt', () => {
    const wrapper = mount(PaywallGate, {
      props: {
        macrosCreated: 100,
        macrosLimit: 100,
        upgradeUrl: 'https://example.com/upgrade',
        enterpriseBundleUrl: 'https://example.com/enterprise',
        content: { template: '<div data-testid="content-stub" />' },
        continueAttemptsIdentity: identity,
      },
      global: {
        stubs: {
          UpgradePrompt: {
            props: ['remainingContinueAttempts'],
            template: '<div data-testid="remaining">{{ remainingContinueAttempts }}</div>',
          },
        },
      },
    });

    expect(wrapper.get('[data-testid="remaining"]').text()).toBe(String(DEFAULT_CONTINUE_ATTEMPTS));
    expect(JSON.parse(localStorage.getItem(continueAttemptsKey(identity)) || '{}')).toMatchObject({
      remainingAttempts: DEFAULT_CONTINUE_ATTEMPTS,
      lastUsedAt: null,
      exhaustedAt: null,
    });
  });

  it('decrements local continue attempts before granting continue editing', async () => {
    const wrapper = mount(PaywallGate, {
      props: {
        macrosCreated: 100,
        macrosLimit: 100,
        upgradeUrl: 'https://example.com/upgrade',
        enterpriseBundleUrl: 'https://example.com/enterprise',
        content: { template: '<div data-testid="content-stub" />' },
        continueAttemptsIdentity: identity,
      },
      global: {
        stubs: {
          UpgradePrompt: {
            props: ['remainingContinueAttempts'],
            emits: ['continueEditing'],
            template: `
              <div>
                <div data-testid="remaining">{{ remainingContinueAttempts }}</div>
                <button data-testid="continue" @click="$emit('continueEditing')">continue</button>
              </div>
            `,
          },
        },
      },
    });

    await wrapper.get('[data-testid="continue"]').trigger('click');

    expect(JSON.parse(localStorage.getItem(continueAttemptsKey(identity)) || '{}')).toMatchObject({
      remainingAttempts: DEFAULT_CONTINUE_ATTEMPTS - 1,
    });
    expect(wrapper.emitted('continue-editing')).toBeTruthy();
  });
});
