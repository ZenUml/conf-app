import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import Mermaid from '@/components/Mermaid.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'

setup((app) => app.use(store))

const MERMAID = `sequenceDiagram
  participant Customer
  participant WebApp
  participant API
  participant Database
  Customer->>WebApp: Submit order
  WebApp->>API: POST /orders
  API->>Database: Save order
  Database-->>API: Order created
  API-->>WebApp: 201 Created
  WebApp-->>Customer: Confirmation`

function configureProductionViewerFixture() {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'account-example',
    siteUrl: 'https://example-tenant.atlassian.net',
    moduleKey: 'zenuml-mermaid-macro-lite',
    extension: {
      content: { id: 'content-example' },
      space: { key: 'DOCS', name: 'Example space' },
      config: { customContentId: 'custom-content-example', macroUuid: 'macro-example' },
    },
  }
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.initializeContext = async () => undefined
  globals.apWrapper.getCurrentPage = async () => ({ title: 'Example page' }) as any

  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMermaidCode', MERMAID)
  store.commit('updateTitle', 'Order processing')
  const diagram = store.state.diagram as any
  diagram.source = DataSource.CustomContent
  diagram.id = 'custom-content-example'
  diagram.isCopy = false
  diagram.recoveredFromOrphan = false
  diagram.snapshotFallback = false
  store.commit('setDiagramAttribution', null)
}

type Story = StoryObj<typeof GenericViewer>

const meta: Meta<typeof GenericViewer> = {
  title: 'Modal/FeedbackPngExport',
  component: GenericViewer,
  parameters: { layout: 'fullscreen' },
  loaders: [
    async () => {
      __resetMermaidLoaderForTests()
      const bundledMermaid = await import('mermaid')
      await loadMermaid({ importer: async () => bundledMermaid, retries: 0 })
      return {}
    },
  ],
  decorators: [
    () => {
      configureProductionViewerFixture()
      return { template: '<story />' }
    },
  ],
  render: () => ({
    components: { GenericViewer, Mermaid },
    template: '<GenericViewer><Mermaid /></GenericViewer>',
  }),
}

export default meta

async function openRealExport(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await waitFor(() => {
    if (!canvasElement.querySelector('.screen-capture-content svg')) {
      throw new Error('Mermaid diagram has not rendered')
    }
  }, { timeout: 15_000 })

  await userEvent.hover(canvasElement.querySelector('.viewer-surface') as HTMLElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'Export PNG' }))
  const exportDialog = await canvas.findByRole('dialog', { name: 'Export Settings' })
  await waitFor(() => expect(exportDialog).toBeVisible())
  return canvas
}

export const CollapsedTrigger: Story = {
  name: 'Collapsed trigger in real Export',
  play: async ({ canvasElement }) => { await openRealExport(canvasElement) },
}

export const ExpandedTrigger: Story = {
  name: 'Expanded trigger in real Export',
  play: async ({ canvasElement }) => {
    const canvas = await openRealExport(canvasElement)
    await userEvent.hover(await canvas.findByTestId('feedback-edge'))
  },
}

/**
 * Full integration evidence: real Viewer action opens its production
 * ExportModal, which captures the real Mermaid DOM, then exposes Feedback as
 * a sibling of the export capture subtree.
 */
export const Open: Story = {
  name: 'Open from real Viewer',
  play: async ({ canvasElement }) => {
    const canvas = await openRealExport(canvasElement)
    const edge = await canvas.findByTestId('feedback-edge')
    await userEvent.hover(edge)
    await userEvent.click(await canvas.findByRole('button', { name: 'Send feedback' }))
    const feedbackDialog = await canvas.findByRole('dialog', { name: 'Send feedback' })
    await waitFor(() => expect(feedbackDialog).toBeVisible())
  },
}
