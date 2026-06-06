import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AIChatPanel from './AIChatPanel.vue'

type Story = StoryObj<typeof AIChatPanel>

const meta: Meta<typeof AIChatPanel> = {
  title: 'AI/AIChatPanel',
  component: AIChatPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Presentation-first AI chat panel for requesting diagram changes. The preview mode demonstrates the conversation and review states without calling an AI backend.',
      },
    },
  },
  decorators: [
    () => ({
      template:
        '<div class="border-r border-slate-200 shadow-lg" style="width: 360px; height: 100vh"><story /></div>',
    }),
  ],
}

export default meta

export const Empty: Story = {
  args: {
    open: true,
    diagramType: 'sequence',
    prototypeMode: true,
  },
}

export const Mermaid: Story = {
  args: {
    open: true,
    diagramType: 'mermaid',
    prototypeMode: true,
  },
}
