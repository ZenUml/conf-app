import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { setup } from '@storybook/vue3-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { markRaw } from 'vue';
import FullscreenRecoveryHost from './FullscreenRecoveryHost.vue';
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
  args: { initialSnapshot: pending, content: markRaw(Mermaid), returnInline: () => {}, planUsage: () => {} },
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
export const SuccessfulDisplay: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Open Fullscreen' }));
  await waitFor(() => expect(canvasElement.querySelector('svg[id^="mermaid-"]')).not.toBeNull(), { timeout: 15000 });
  await waitFor(() => expect(canvas.getByText(/Temporary Fullscreen access ends/)).toBeVisible(), { timeout: 15000 });
} };
export const Active: Story = { args: { initialSnapshot: active } };
export const ExpiredNewOpen: Story = { args: { initialSnapshot: { ...active, state: 'expired' } } };
export const AdvanceNotice: Story = { args: { initialSnapshot: { ...pending, state: 'notice', noticeVersion: 'v1', enforceAt: '2026-10-31T00:00:00.000Z' } } };
