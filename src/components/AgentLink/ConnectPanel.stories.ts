import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import ConnectPanel from './ConnectPanel.vue'
import { rememberAgentLinkClient } from '@/composables/agentLink/clientMemory'

type Story = StoryObj<typeof ConnectPanel>

// Deliberately synthetic: it has the public pairing-code shape but is not a
// live session and carries no customer, deployment, or document information.
const DEMO_PAIRING_CODE = 'CL-8F3K7Q'

function installClipboardStub() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => undefined },
  })
}

function resetFixtureMemory(label?: 'Codex' | 'Claude Code' | 'Cursor') {
  window.localStorage.clear()
  if (label) rememberAgentLinkClient(label)
}

function renderRail(args: Args) {
  return {
    components: { ConnectPanel },
    setup() {
      installClipboardStub()
      return { args }
    },
    template: `
      <div style="width: 316px; height: 600px; background: #fff;">
        <ConnectPanel v-bind="args" />
      </div>
    `,
  }
}

const meta: Meta<typeof ConnectPanel> = {
  title: 'Agent Link/Disconnected lifecycle',
  component: ConnectPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The 316px Agent Link rail across connection lifecycle states. All pairing values are synthetic Storybook fixtures.',
      },
    },
  },
  args: {
    token: null,
    activityFeed: [],
    diagramTitle: 'Checkout sequence',
  },
  render: renderRail,
}

export default meta

export const FirstPairing: Story = {
  name: '1 · First pairing',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'waiting', token: DEMO_PAIRING_CODE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Connect' })).toBeVisible()
    await expect(canvas.getByTestId('agent-link-prompt')).toHaveTextContent(DEMO_PAIRING_CODE)
    await expect(canvas.getByRole('button', { name: 'Copy prompt' })).toBeVisible()
  },
}

export const WaitingForAgent: Story = {
  name: '2 · Waiting after prompt copied',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'waiting', token: DEMO_PAIRING_CODE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Copy prompt' }))
    await expect(canvas.getByRole('heading', { name: 'Waiting for your AI assistant' })).toBeVisible()
    await expect(canvas.getByTestId('agent-link-client-carousel')).toBeVisible()
    await expect(canvas.queryAllByRole('button')).toHaveLength(0)
  },
}

export const AutomaticReconnect: Story = {
  name: '3 · Automatic recovery',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: {
    state: 'suspended',
    token: DEMO_PAIRING_CODE,
    clientName: 'Claude Code',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header')).toBeVisible()
    await expect(canvas.getByTestId('agent-link-live-badge-suspended')).toHaveTextContent('Connecting')
    await expect(canvas.queryByText(/reconnect|resume/i)).not.toBeInTheDocument()
    await expect(canvas.queryAllByRole('button')).toHaveLength(0)
  },
}

export const ReconnectNeeded: Story = {
  name: '4 · Connection ended',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'recovery_exhausted', token: DEMO_PAIRING_CODE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Connect' })).toBeVisible()
    await expect(canvas.getByText(/This connection ended/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy prompt' })).toBeVisible()
    await expect(canvas.getByText('Need help?')).toBeVisible()
  },
}

export const PairingExpired: Story = {
  name: '5 · Pairing expired',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'expired' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Connection expired')).toBeVisible()
    await expect(canvas.queryByText(/diagram is saved/i)).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Connect' })).toBeVisible()
  },
}

export const ExplicitDisconnect: Story = {
  name: '6 · Explicit disconnect',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'closed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Disconnected')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Connect' })).toBeVisible()
    await expect(canvas.queryByText(/another agent/i)).not.toBeInTheDocument()
  },
}

export const ProtocolIncompatibility: Story = {
  name: '7 · Protocol incompatibility',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'incompatible' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Your MCP needs an update' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy prompt to upgrade your MCP' })).toBeVisible()
  },
}

export const RememberedAgentCue: Story = {
  name: '8 · Initial pairing with remembered cue',
  decorators: [
    () => {
      resetFixtureMemory('Codex')
      return { template: '<story />' }
    },
  ],
  args: { state: 'waiting', token: DEMO_PAIRING_CODE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-last-agent')).toHaveTextContent('Last connected with Codex')
    await expect(canvas.getByRole('button', { name: 'Copy prompt' })).toBeVisible()
    await expect(canvas.queryByText(/another agent/i)).not.toBeInTheDocument()
  },
}

export const ConnectedClaudeCode: Story = {
  name: '9 · Connected — Claude Code',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: {
    state: 'connected',
    clientName: 'Claude Code',
    expiresAt: Date.now() + 8 * 60 * 1000,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header-name')).toHaveTextContent('Claude Code')
    await expect(canvas.getByTestId('agent-link-client-brand-icon')).toBeVisible()
    await expect(canvas.queryByTestId('agent-link-client-carousel')).not.toBeInTheDocument()
  },
}

export const ConnectedGenericClient: Story = {
  name: '10 · Connected — generic client',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: {
    state: 'connected',
    clientName: 'an AI agent',
    expiresAt: Date.now() + 8 * 60 * 1000,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header-name')).toHaveTextContent('Connected')
    await expect(canvas.getByTestId('agent-link-client-generic-icon')).toBeVisible()
  },
}

export const ConnectedCodex: Story = {
  name: '11 · Connected — Codex',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: {
    state: 'connected',
    clientName: 'Codex',
    expiresAt: Date.now() + 8 * 60 * 1000,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-status-header-name')).toHaveTextContent('Codex')
    await expect(canvas.getByTestId('agent-link-client-generic-icon')).toBeVisible()
  },
}

export const OptionalHelpExpanded: Story = {
  name: '12 · Optional help — expanded',
  decorators: [
    () => {
      resetFixtureMemory()
      return { template: '<story />' }
    },
  ],
  args: { state: 'recovery_exhausted', token: DEMO_PAIRING_CODE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Need help?'))
    await expect(canvas.getByText(/This is optional/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy help message' })).toBeVisible()
  },
}
