import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ref } from 'vue'
import { showCloseWithoutSavingDialog } from './modalService'

// The editor's "close without saving" dialog (#934). It is plain DOM, so the
// story opens it from a button the way the editor's Close button does.
const meta: Meta = {
  title: 'Editor/Diagram/modalService',
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

const renderOpener = () => ({
  setup() {
    const result = ref('')
    const open = async () => { result.value = await showCloseWithoutSavingDialog() }
    return { open, result }
  },
  template: '<div class="p-6"><button type="button" @click="open">Close</button><output data-testid="result">{{ result }}</output></div>',
})

export const Open: Story = {
  render: renderOpener,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close' }))
  },
}

export const KeyboardOnly: Story = {
  render: renderOpener,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const opener = canvas.getByRole('button', { name: 'Close' })
    opener.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await waitFor(() => within(document.body).getByRole('dialog', { name: 'All changes will be lost!' }))
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    await expect(cancel).toHaveFocus()
    await userEvent.tab()
    await expect(within(dialog).getByRole('button', { name: 'Discard Changes' })).toHaveFocus()
    await userEvent.tab()
    await expect(cancel).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.getByTestId('result')).toHaveTextContent('cancel'))
    await expect(opener).toHaveFocus()
  },
}
