import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ConnectPanel from './ConnectPanel.vue'

const meta: Meta<typeof ConnectPanel> = {
  title: 'Agent Link/Connect Panel',
  component: ConnectPanel,
  parameters: { layout: 'centered' },
  args: {
    state: 'suspended',
    token: 'storybook-token',
    activityFeed: [],
    diagramTitle: 'Example diagram',
  },
}

export default meta

type Story = StoryObj<typeof ConnectPanel>

export const Reconnecting: Story = {}

export const ReconnectExhausted: Story = {
  args: { noticeReason: 'connection_lost' },
}
