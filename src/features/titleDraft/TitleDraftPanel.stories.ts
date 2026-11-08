import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TitleDraftPanel from './TitleDraftPanel.vue'

const mermaid = `flowchart TD
  A[Request received] --> B[Check order details]
  B --> C{Approved?}
  C -->|Yes| D[Create shipment]
  C -->|No| E[Notify requester]
  D --> F[Confirm delivery]`

const meta: Meta<typeof TitleDraftPanel> = {
  title: 'TitleDraft/TitleDraftPanel',
  component: TitleDraftPanel,
  args: { mermaid, onClose: () => {} },
  decorators: [() => ({ template: '<div style="width:968px;height:611px;border:1px solid #dcdfe4"><story /></div>' })],
}
export default meta

type Story = StoryObj<typeof TitleDraftPanel>

export const Ready: Story = {
  args: { add: () => new Promise(() => {}) },
}

export const AddRefused: Story = {
  args: { add: async () => ({ result: 'forbidden' as const }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The button stays disabled until the Mermaid preview has rendered.
    const button = canvas.getByTestId('title-draft-add')
    await waitFor(() => expect(button).toBeEnabled(), { timeout: 10000 })
    await userEvent.click(button)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('You need permission to edit this page')
  },
}
