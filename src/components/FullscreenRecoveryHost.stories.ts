import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { setup } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { markRaw } from 'vue';
import FullscreenRecoveryHost from './FullscreenRecoveryHost.vue';
import { isFullscreenRecoveryEligible } from '@/utils/paywall/fullscreenRecoveryEligibility';
import Mermaid from './Mermaid.vue';
import store from '@/model/store2';
import { DiagramType } from '@/model/Diagram/Diagram';
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid';
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge';
import type { RecoverySnapshot } from '../../shared/fullscreenRecovery';

setup(app => app.use(store));
const pending: RecoverySnapshot = { state: 'pending_activation', serverNow: '2026-10-24T00:00:00.000Z', policyVersion: 'fullscreen-contact-v1',
  request: { id: 'example-request', scenarios: ['present'], note: '', email: 'reader@example.com', createdAt: '2026-10-24T00:00:00.000Z' },
  grant: { id: 'example-grant', activatedAt: null, expiresAt: null } };
const active: RecoverySnapshot = { ...pending, state: 'active', grant: { id: 'example-grant', activatedAt: pending.serverNow, expiresAt: '2026-10-31T00:00:00.000Z' } };
const meta: Meta<typeof FullscreenRecoveryHost> = {
  title: 'Viewer/FullscreenRecoveryHost', component: FullscreenRecoveryHost,
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Real Mermaid renderer and display receipt; synthetic access state and Forge responses. No customer data or email.' } } },
  args: { context: { spaceKey: 'EXAMPLE' }, initialSnapshot: pending, content: markRaw(Mermaid), returnInline: () => {}, planUsage: () => {} },
  loaders: [async () => {
    resetStubResponses(); stubResponses.remote.push({ match: '/api/fullscreen-recovery', body: { snapshot: active, outcome: 'activated' } });
    store.commit('updateDiagramType', DiagramType.Mermaid);
    store.commit('updateMermaidCode', 'sequenceDiagram\n  participant Reader\n  participant Support\n  Reader->>Support: Explain the context\n  Support-->>Reader: Agree the next step');
    __resetMermaidLoaderForTests();
    const bundled = await import('mermaid'); await loadMermaid({ importer: async () => bundled, retries: 0 });
    return {};
  }],
};
export default meta;
type Story = StoryObj<typeof FullscreenRecoveryHost>;
export const ImmediateContactGate: Story = { args: { initialSnapshot: { state: 'not_requested', serverNow: pending.serverNow, policyVersion: pending.policyVersion } } };
export const SuccessfulDisplay: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Open Fullscreen' }));
  await waitFor(() => expect(canvasElement.querySelector('svg[id^="mermaid-"]')).not.toBeNull(), { timeout: 15000 });
  await waitFor(() => expect(canvas.getByText(/Temporary Fullscreen access ends/)).toBeVisible(), { timeout: 15000 });
} };
export const Active: Story = { args: { initialSnapshot: active } };
export const ExpiredNewOpen: Story = { args: { initialSnapshot: { ...active, state: 'expired' } } };

/** Uses the same count/paid predicate as the viewer boundary. Old grant state cannot gate an ordinary space. */
function eligibilityStory(count: number): Story {
  return { render: args => ({
    components: { FullscreenRecoveryHost, Mermaid },
    setup: () => ({ args, eligible: isFullscreenRecoveryEligible({ isLite: true, count, countSource: 'kv',
      paidKnown: true, paid: false, policySource: 'default_on', spaceKey: 'EXAMPLE' }) }),
    template: '<FullscreenRecoveryHost v-if="eligible" v-bind="args" /><Mermaid v-else />',
  }), args: { initialSnapshot: count < 100 ? { ...active, state: 'expired' } : {
    state: 'not_requested', serverNow: pending.serverNow, policyVersion: pending.policyVersion } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (count < 100) {
      await waitFor(() => expect(canvasElement.querySelector('svg[id^="mermaid-"]')).not.toBeNull(), { timeout: 15000 });
      await expect(canvas.queryByRole('button', { name: 'Contact support' })).toBeNull();
      await expect(canvas.queryByText(/Temporary Fullscreen access ended/)).toBeNull();
    } else {
      await expect(canvas.getByText(/This space has reached the free limit of 100 diagrams/)).toBeVisible();
    }
  } };
}
export const BelowLimitOrdinaryFullscreen: Story = eligibilityStory(99);
export const AtLimitContactRecovery: Story = eligibilityStory(100);
