import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import BylineDiagrams from './BylineDiagrams.vue'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { Modal } from '@/stubs/forge-bridge'

/**
 * The post-save ("created") panel of the byline popup. It is only reachable by
 * creating a diagram, so each story's `play` drives the real flow: pick a type,
 * let the (stubbed) Forge modal "close", and let the page re-read find the new
 * diagram. The loader decides the three inputs the panel's wording depends on:
 * whether the host page is in the editor, and whether the document has focus
 * (the save-time copy only runs while it does).
 */
type Story = StoryObj<typeof BylineDiagrams>

const EDIT_CONTEXT = { cloudId: 'cloud-1', extension: { isEditing: true } }
const VIEW_CONTEXT = { cloudId: 'cloud-1', extension: {} }

const savedChild = {
  id: '99',
  title: 'Checkout flow',
  body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B: hi' }) } },
}

function arrange({ editing, focused }: { editing: boolean; focused: boolean }) {
  const ap = globals.apWrapper as any
  ap._getCurrentPageId = async () => 'page-1'
  ap.getAttachmentsV2 = async () => []
  ap.referencedCustomContentIds = async () => undefined
  ap.listPageDiagramContents = async () => [{ results: [] }]
  ;(forgeGlobal as any).forgeContext = editing ? EDIT_CONTEXT : VIEW_CONTEXT
  Object.defineProperty(document, 'hasFocus', { value: () => focused, configurable: true })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  })
}

async function saveADiagram(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByTestId('byline-type-sequence'))
  ;(globals.apWrapper as any).listPageDiagramContents = async () => [{ results: [savedChild] }]
  await Modal.lastOptions.onClose()
  await canvas.findByTestId('byline-created')
}

const meta: Meta<typeof BylineDiagrams> = {
  title: 'Modal/BylineDiagrams',
  component: BylineDiagrams,
  parameters: { layout: 'centered' },
}

export default meta

export const CreatedViewModeNotCopied: Story = {
  name: 'Created — view mode, not copied',
  loaders: [async () => arrange({ editing: false, focused: false })],
  play: async ({ canvasElement }) => {
    await saveADiagram(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('byline-created')).toHaveTextContent('Saved — copy the link to place it')
    await expect(canvas.getByTestId('byline-open-editor')).toHaveTextContent('Open editor & paste')
  },
}

export const CreatedEditModeNotCopied: Story = {
  name: 'Created — edit mode, not copied',
  loaders: [async () => arrange({ editing: true, focused: false })],
  play: async ({ canvasElement }) => {
    await saveADiagram(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('byline-created-done')).toHaveTextContent('Copy link & close')
  },
}

export const CreatedCopied: Story = {
  name: 'Created — copied',
  loaders: [async () => arrange({ editing: true, focused: true })],
  play: async ({ canvasElement }) => {
    await saveADiagram(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('byline-created')).toHaveTextContent('Saved — link copied to clipboard')
    await expect(canvas.getByTestId('byline-created-done')).toHaveTextContent('Done')
  },
}
