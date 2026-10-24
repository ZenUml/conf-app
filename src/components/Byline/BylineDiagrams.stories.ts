import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BylineDiagrams from './BylineDiagrams.vue'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'

const diagram = {
  id: '123456',
  title: 'Order flow',
  body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B: order' }) } },
}

function useUnplacedFixture() {
  forgeGlobal.forgeContext = { cloudId: 'storybook-cloud', extension: { content: { id: '123' } } }
  const api = globals.apWrapper as any
  api._getCurrentPageId = async () => '123'
  api.listPageDiagramContents = async () => [{ results: [diagram] }]
  api.referencedCustomContentIds = async () => []
  api.getAttachmentsV2 = async () => []
}

const meta: Meta<typeof BylineDiagrams> = {
  title: 'Page banner/BylineDiagrams',
  component: BylineDiagrams,
  parameters: { layout: 'centered' },
  decorators: [() => {
    useUnplacedFixture()
    return { template: '<div style="width: 640px; min-height: 420px; background: white"><story /></div>' }
  }],
}

export default meta
type Story = StoryObj<typeof BylineDiagrams>

/** An unplaced diagram keeps its primary placement action visible. */
export const Unplaced: Story = {}
