import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import GetStarted from '@/components/GetStarted/GetStarted.vue'
import FeedbackHost from './FeedbackHost.vue'
import { storyFeedbackContext } from './feedbackStoryFixtures'

type Story = StoryObj<typeof FeedbackHost>
const meta: Meta<typeof FeedbackHost> = {
  title: 'Dashboard/Feedback',
  component: FeedbackHost,
  parameters: { layout: 'fullscreen' },
  args: { context: storyFeedbackContext('dashboard') },
  render: (args) => ({
    components: { GetStarted, FeedbackHost },
    setup: () => ({ args }),
    template: '<GetStarted /><FeedbackHost v-bind="args" />',
  }),
}
export default meta

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByTestId('feedback-edge'))
    await userEvent.click(canvas.getByRole('button', { name: 'Send feedback' }))
    await expect(canvas.getByRole('dialog', { name: 'Send feedback' })).toBeVisible()
  },
}
