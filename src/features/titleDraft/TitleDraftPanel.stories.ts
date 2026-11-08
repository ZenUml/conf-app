import type { Meta, StoryObj } from '@storybook/vue3-vite'
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
    canvasElement.querySelector<HTMLButtonElement>('[data-testid="title-draft-add"]')?.click()
  },
}
