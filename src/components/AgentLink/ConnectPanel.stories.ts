import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import ConnectPanel from './ConnectPanel.vue'

type Story = StoryObj<typeof ConnectPanel>

const DEMO_ACTIVITY = [
  { summary: 'Read “Checkout sequence”', at: Date.now() - 3 * 60 * 1000 },
  { summary: 'Diagram updated', at: Date.now() - 90 * 1000 },
  { summary: 'Searched “payment failure” → 2 hits', at: Date.now() - 30 * 1000 },
]

function renderRail(args: Args) {
  return {
    components: { ConnectPanel },
    setup: () => ({ args }),
    template: `
      <div style="width: 316px; height: 600px; background: #fff;">
        <ConnectPanel v-bind="args" />
      </div>
    `,
  }
}

const meta: Meta<typeof ConnectPanel> = {
  title: 'Agent Link/Quiet Signal rail',
  component: ConnectPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The 316px fullscreen Agent Link rail after pairing. Fixtures contain no live token, document content, or deployment data.',
      },
    },
  },
  args: {
    state: 'connected',
    token: null,
    activityFeed: DEMO_ACTIVITY,
    expiresAt: Date.now() + 8 * 60 * 1000,
  },
  render: renderRail,
}

export default meta

export const ConnectedClaudeCode: Story = {
  args: { clientName: 'claude-code' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header-name')).toHaveTextContent('Claude Code')
    await expect(canvas.getByTestId('agent-link-client-brand-icon')).toBeVisible()
    await expect(canvas.getByTestId('agent-link-live-badge')).toHaveTextContent('Connected')
    await expect(canvas.queryByText('Linked to')).not.toBeInTheDocument()
  },
}

export const ConnectedCodex: Story = {
  args: { clientName: 'codex-mcp-client' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header-name')).toHaveTextContent('Codex')
    await expect(canvas.getByTestId('agent-link-client-brand-icon')).toBeVisible()
  },
}

export const ConnectedGenericClient: Story = {
  args: { clientName: 'unrecognized-client' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header-name')).toHaveTextContent('AI assistant')
    await expect(canvas.getByTestId('agent-link-client-generic-icon')).toBeVisible()
    await expect(canvas.queryByText('unrecognized-client')).not.toBeInTheDocument()
  },
}

export const CurrentWorkFirst: Story = {
  args: {
    clientName: 'cursor-client',
    thinking: 'thinking',
    activityFeed: [
      ...DEMO_ACTIVITY,
      { summary: 'Agent is updating the diagram…', at: Date.now() },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const entries = canvas.getAllByTestId('agent-link-activity-entry')
    await expect(entries[0]).toHaveTextContent('Agent is updating the diagram…')
    await expect(canvas.queryByTestId('agent-link-thinking-banner')).not.toBeInTheDocument()
  },
}

export const AutomaticRecoveryKeepsTimeline: Story = {
  args: {
    state: 'suspended',
    clientName: 'claude-code',
    activityFeed: [
      ...DEMO_ACTIVITY,
      { summary: 'Connection paused', at: Date.now() - 1 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-live-badge-suspended')).toHaveTextContent('Connecting')
    await expect(canvas.getByTestId('agent-link-activity-feed')).toHaveTextContent('Diagram updated')
    await expect(canvas.queryByText('Connection paused')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('agent-link-suspended-status')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Disconnect' })).toBeVisible()
  },
}
