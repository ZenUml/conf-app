import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import FeedbackDialog from './FeedbackDialog.vue'
import { storyBlockedHandoff, storyFeedbackContext, storySubmit } from './feedbackStoryFixtures'

type Story = StoryObj<typeof FeedbackDialog>
const context = storyFeedbackContext('viewer')
const captureCurrentView = async () => ({
  dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjRmNWY3Ii8+PHJlY3QgeD0iMTIiIHk9IjU4IiB3aWR0aD0iMTA4IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzBjNjZlNCIvPjxyZWN0IHg9IjIwMCIgeT0iNTgiIHdpZHRoPSIxMDgiIGhlaWdodD0iNjQiIHJ4PSI4IiBmaWxsPSJ3aGl0ZSIgc3Ryb2tlPSIjMGM2NmU0Ii8+PHBhdGggZD0iTTEyMCA5MGg4MCIgc3Ryb2tlPSIjNDQ1NDZmIiBzdHJva2Utd2lkdGg9IjQiLz48L3N2Zz4=',
  name: 'current-view.png',
  method: 'current_view' as const,
})

const meta: Meta<typeof FeedbackDialog> = {
  title: 'Modal/FeedbackDialog',
  component: FeedbackDialog,
  parameters: { layout: 'centered' },
  args: { context, submit: storySubmit, handoff: storyBlockedHandoff, captureCurrentView },
}
export default meta

export const Idle: Story = {}

export const TextEntered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByLabelText('Describe your feedback'),
      'The diagram is difficult to read at this size.\n- Zooming in helps\n- The initial fit is too small',
    )
  },
}

export const CapturePreview: Story = {
  args: {
    captureCurrentView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Capture current view' }))
    await expect(await canvas.findByAltText('Captured view')).toBeVisible()
  },
}

export const ExpandedContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('8 fields attached automatically'))
    await expect(canvas.getByText('account-example')).toBeVisible()
  },
}

export const SavedAndSupportBlocked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Describe your feedback'), 'The diagram is too small.')
    await userEvent.click(canvas.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(canvas.getByText('Your feedback has been saved.')).toBeVisible())
    await expect(canvas.getByRole('link', { name: 'Continue to support' })).toBeVisible()
  },
}

export const SubmissionFailed: Story = {
  args: { submit: async () => { throw new Error('StorageUnavailable') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Describe your feedback'), 'The diagram is too small.')
    await userEvent.click(canvas.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(canvas.getByRole('alert')).toHaveTextContent('could not be sent'))
  },
}
