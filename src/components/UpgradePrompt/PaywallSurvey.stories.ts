import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PaywallSurvey from './PaywallSurvey.vue'

const meta: Meta<typeof PaywallSurvey> = {
  title: 'Shared/PaywallSurvey',
  component: PaywallSurvey,
  parameters: {
    layout: 'centered',
    viewport: { defaultViewport: 'forgeModal' },
  },
  args: {
    spaceKey: 'STORY',
    macroCount: 105,
    actionType: 'page_editor',
  },
}

export default meta

type Story = StoryObj<typeof PaywallSurvey>

export const Unanswered: Story = {}
