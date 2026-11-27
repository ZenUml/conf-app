import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import Workspace from '@/components/Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'

// Workspace.vue reads the store through mapState and useStore(), so the Vuex
// plugin goes on Storybook's root app (see DiagramPaste.stories.ts).
setup((app: App) => {
  app.use(store)
})

const PLANTUML = `@startuml
actor Customer
Customer -> Shop: place order
Shop --> Customer: confirmation
@enduml`

const PROSE_ABOVE = `# 1 Overview

flowchart LR
  Customer[Customer] --> Shop[Shop]
  Shop --> Payment[Payment]`

const MARKDOWN_DOCUMENT = `# 1 Overview

flowchart LR
  Customer --> Shop

# 2 Checkout
The shop asks the payment service.

sequenceDiagram
  Shop->>Payment: charge
  Payment-->>Shop: paid`

function prepare(mermaidCode: string) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  localStorage.removeItem('zenuml-preferred-diagram-type')
  for (const type of [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.Markdown]) {
    localStorage.setItem(`zenuml.starterGalleryAutoOpened.unknown-cloud.${type}`, '1')
  }
  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMarkdownCode', undefined)
  store.commit('updateMermaidCode', '')
  store.commit('updateTitle', 'Order flow')
  store.commit('updateError', null)
  ;(store.state as any).diagram.id = '12345'
  ;(store.state as any).diagram.isNew = false
  // Set the source after mount so the hint's watcher sees the change.
  setTimeout(() => store.commit('updateMermaidCode', mermaidCode), 0)
}

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/ForeignDialectHint',
  component: Workspace,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { Workspace },
    template: '<div style="height: 640px"><Workspace /></div>',
  }),
}
export default meta
type Story = StoryObj<typeof meta>

export const PlantUmlInMermaid: Story = {
  beforeEach: () => prepare(PLANTUML),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('foreign-dialect-hint')).toHaveTextContent('This looks like PlantUML, not Mermaid'))
    await expect(canvas.getByTestId('foreign-dialect-switch')).toHaveTextContent('Switch to PlantUML')
  },
}

export const ProseAboveDiagram: Story = {
  beforeEach: () => prepare(PROSE_ABOVE),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('foreign-dialect-hint')).toHaveTextContent('Text above the diagram type stops Mermaid'))
    await expect(canvas.getByTestId('foreign-dialect-switch')).toHaveTextContent('Turn it into comments')
  },
}

export const ProseAboveDiagramTurnedIntoComments: Story = {
  beforeEach: () => prepare(PROSE_ABOVE),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('foreign-dialect-hint')).toBeTruthy())
    await userEvent.click(canvas.getByTestId('foreign-dialect-switch'))
    await waitFor(() => expect((store.state.diagram.mermaidCode ?? '').startsWith('%% # 1 Overview')).toBe(true))
    await waitFor(() => expect(canvas.queryByTestId('foreign-dialect-hint')).toBeNull())
  },
}

export const MarkdownDocument: Story = {
  beforeEach: () => prepare(MARKDOWN_DOCUMENT),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('foreign-dialect-hint')).toHaveTextContent('Markdown document with several diagrams'))
    await expect(canvas.getByTestId('foreign-dialect-switch')).toHaveTextContent('Switch to Markdown')
  },
}
