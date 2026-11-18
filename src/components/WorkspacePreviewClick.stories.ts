import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { expect, waitFor } from 'storybook/test'
import Workspace from './Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { classifyPreviewTarget } from '@/utils/viewport/previewClickTracker'

// P6 measurement (editor_preview_element_clicked). These stories render the
// real editor preview so the element classifier is checked against the SVG
// Mermaid and PlantUML actually produce, not against hand-written fixtures.
setup((app: App) => {
  app.use(store)
})

const MERMAID_FLOWCHART = `flowchart LR
  subgraph Core[Core services]
    A[Order API] --> B[(Orders DB)]
  end
  C[Client] -->|POST /orders| A`

const MERMAID_ER = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains`

const PLANTUML_SEQUENCE = `@startuml
Alice -> Bob: Request
Bob --> Alice: Response
@enduml`

function prepare(type: DiagramType, code: string) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  for (const t of [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml]) {
    localStorage.setItem(`zenuml.starterGalleryAutoOpened.unknown-cloud.${t}`, '1')
  }
  ;(store.state as any).diagram.id = 'preview-click-story'
  ;(store.state as any).diagram.isNew = false
  store.commit('updateTitle', 'Preview click')
  if (type === DiagramType.Mermaid) store.commit('updateMermaidCode', code)
  if (type === DiagramType.PlantUml) store.commit('updatePlantUmlCode', code)
  store.commit('updateDiagramType', type)
}

const preview = () => document.querySelector('#workspace-right') as HTMLElement

async function kindsOf(selector: string) {
  let elements: Element[] = []
  await waitFor(() => {
    elements = Array.from(preview().querySelectorAll(selector))
    expect(elements.length).toBeGreaterThan(0)
  }, { timeout: 15_000 })
  return elements.map(el => classifyPreviewTarget(el, preview()))
}

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/WorkspacePreviewClick',
  component: Workspace,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'P6 measurement: the editor preview counts clicks on diagram elements (editor_preview_element_clicked). Nothing changes on screen; these stories check the element classifier on real Mermaid and PlantUML SVG.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof Workspace>

/** Mermaid flowchart with a subgraph: nodes, the subgraph box, edges, and edge labels. */
export const MermaidFlowchart: Story = {
  decorators: [() => {
    prepare(DiagramType.Mermaid, MERMAID_FLOWCHART)
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    expect(new Set(await kindsOf('svg g.node rect, svg g.node path'))).toEqual(new Set(['node']))
    expect(new Set(await kindsOf('svg g.cluster > rect'))).toEqual(new Set(['cluster']))
    expect(new Set(await kindsOf('svg .edgeLabel'))).toEqual(new Set(['edge']))
  },
}

/** Mermaid ER diagram: entity boxes are nodes. */
export const MermaidEr: Story = {
  decorators: [() => {
    prepare(DiagramType.Mermaid, MERMAID_ER)
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    expect(new Set(await kindsOf('svg [id*="-entity-"] path, svg [id*="-entity-"] rect'))).toEqual(new Set(['node']))
  },
}

/** PlantUML sequence (in-browser engine): participant boxes are nodes, names are labels. */
export const PlantUmlSequence: Story = {
  decorators: [() => {
    prepare(DiagramType.PlantUml, PLANTUML_SEQUENCE)
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    // The in-browser engine draws flat SVG: participant boxes are bare rects.
    expect(new Set(await kindsOf('svg[data-diagram-type] rect[fill="#E2E2F0"]'))).toEqual(new Set(['node']))
    expect(new Set(await kindsOf('svg[data-diagram-type] text'))).toEqual(new Set(['label']))
  },
}
