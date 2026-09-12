import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { AGENT_LINK_CLIENT_MEMORY_KEY, rememberAgentLinkClient } from '@/composables/agentLink/clientMemory'
import ConnectPanel from './ConnectPanel.vue'

type Story = StoryObj<typeof ConnectPanel>

const meta: Meta<typeof ConnectPanel> = {
  title: 'Viewer/Agent Link/ConnectPanel',
  component: ConnectPanel,
  parameters: { layout: 'centered' },
  args: {
    state: 'waiting',
    token: 'EXAMPLE-CODE',
    activityFeed: [],
    diagramTitle: 'Order checkout',
  },
  beforeEach: () => {
    const previousMemory = localStorage.getItem(AGENT_LINK_CLIENT_MEMORY_KEY)
    const previousBackend = forgeGlobal.zenumlRemoteBaseUrl
    localStorage.removeItem(AGENT_LINK_CLIENT_MEMORY_KEY)
    forgeGlobal.zenumlRemoteBaseUrl = 'https://backend.example'
    return () => {
      if (previousMemory === null) localStorage.removeItem(AGENT_LINK_CLIENT_MEMORY_KEY)
      else localStorage.setItem(AGENT_LINK_CLIENT_MEMORY_KEY, previousMemory)
      forgeGlobal.zenumlRemoteBaseUrl = previousBackend
    }
  },
  render: (args) => ({
    components: { ConnectPanel },
    setup: () => ({ args, expiresAt: Date.now() + 8 * 60_000 }),
    template: '<div style="width:340px;max-width:100%;height:690px"><ConnectPanel v-bind="args" :expires-at="args.state === \'expired\' ? Date.now() - 1000 : expiresAt" /></div>',
  }),
}
export default meta

export const Waiting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-prompt')).toBeVisible()
    await expect(canvas.getByTestId('agent-link-setup-command')).toBeVisible()
  },
}

export const Remembered: Story = {
  play: async ({ canvasElement }) => {
    rememberAgentLinkClient('Codex')
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('agent-link-remembered-client')).toHaveTextContent('Codex')
    await expect(canvas.getByTestId('agent-link-prompt')).toBeVisible()
    await expect(canvas.getByTestId('agent-link-setup-command')).toBeVisible()
  },
}

export const Connected: Story = {
  args: { state: 'connected', progressStage: 'verified', clientName: 'Codex' },
}

export const Expired: Story = { args: { state: 'expired' } }

export const ConnectionLost: Story = { args: { state: 'recovery_exhausted' } }

export const ProtocolMismatch: Story = { args: { state: 'incompatible' } }
