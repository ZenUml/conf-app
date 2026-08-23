import type { Meta, StoryObj } from '@storybook/vue3-vite';
import PaywallExtensionIntake from './PaywallExtensionIntake.vue';
import type { SubmitPaywallExtension } from '@/utils/paywall/paywallExtension';

const grantFixture: SubmitPaywallExtension = async () => ({
  status: 'granted',
  requestId: 'storybook-request',
  isReplay: false,
  grant: {
    grantId: 'storybook-grant',
    grantedAt: '2026-08-23T23:00:00.000Z',
    expiresAt: '2026-08-30T23:00:00.000Z',
    extensionDays: 7,
  },
});

const repeatFixture: SubmitPaywallExtension = async () => ({
  status: 'manual_review',
  requestId: 'storybook-repeat',
  isReplay: false,
  priorGrantCount: 1,
  message: 'Manual review',
});

const meta: Meta<typeof PaywallExtensionIntake> = {
  title: 'Paywall/Extension intake — implemented',
  component: PaywallExtensionIntake,
  tags: ['autodocs'],
  args: {
    spaceKey: 'STORY',
    macroCount: 123,
    attemptsRemaining: 0,
    submitRequest: grantFixture,
  },
  parameters: {
    layout: 'centered',
    controls: { exclude: ['submitRequest'] },
    docs: {
      description: {
        component: 'Production five-question intake with inert submit adapters. No Forge, D1, Mixpanel, email, or support request is invoked by these stories.',
      },
    },
  },
  decorators: [() => ({ template: '<div style="width:680px;background:white;border:1px solid #ddd;border-radius:12px"><story /></div>' })],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstAutomaticGrant: Story = {};

export const RepeatRoutesToReview: Story = {
  args: { submitRequest: repeatFixture },
};
