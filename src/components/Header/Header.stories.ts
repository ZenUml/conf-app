import type { Meta, StoryObj } from '@storybook/vue3-vite'
import Header from './Header.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'

type Story = StoryObj<typeof Header>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Prevent openUrl() from navigating away in Storybook. */
function stubForge() {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
}

function setupStore({
  diagramType = DiagramType.Sequence,
  title = '',
  code = '',
  mermaidCode = '',
  plantUmlCode = '',
  isNew = false,
  id = '',
}: {
  diagramType?: DiagramType
  title?: string
  code?: string
  mermaidCode?: string
  plantUmlCode?: string
  isNew?: boolean
  id?: string
} = {}) {
  store.commit('updateDiagramType', diagramType)
  store.commit('updateCode2', code)
  store.commit('updateMermaidCode', mermaidCode)
  store.commit('updatePlantUmlCode', plantUmlCode)
  store.commit('updateTitle', title)
  // isNew and id live directly on the diagram state object.
  ;(store.state as any).diagram.isNew = isNew
  ;(store.state as any).diagram.id = id
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof Header> = {
  title: 'Layout/Header',
  component: Header,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Top toolbar in the Workspace editor. Contains the diagram-type tab switcher, title input, AI Chat entry, Examples and Help buttons, and the Publish button.',
      },
    },
  },
  decorators: [
    // Provide Vuex store as a Vue plugin so mapState / mapMutations resolve in Header.
    () => ({
      template: '<story />',
      // @ts-expect-error — Storybook Vue3 decorator `app` param; not in the TS overload
      app: (app: import('vue').App) => app.use(store),
    }),
    // Reset forge globals before each story.
    () => {
      stubForge()
      return { template: '<story />' }
    },
  ],
}

export default meta

// ---------------------------------------------------------------------------
// Sequence — no title (Publish disabled)
// ---------------------------------------------------------------------------

/**
 * Default state when creating a new Sequence diagram.
 * The Publish button is disabled because the title is empty.
 * Hovering the Publish button reveals the "Add a diagram title" tooltip.
 */
export const SequenceNoTitle: Story = {
  decorators: [
    () => {
      setupStore({ diagramType: DiagramType.Sequence, title: '', isNew: true })
      return { template: '<story />' }
    },
  ],
}

// ---------------------------------------------------------------------------
// Sequence — title provided (Publish enabled)
// ---------------------------------------------------------------------------

/**
 * Sequence diagram with a title filled in.
 * The Publish button is active and clickable.
 */
export const SequenceWithTitle: Story = {
  decorators: [
    () => {
      setupStore({
        diagramType: DiagramType.Sequence,
        title: 'Payment Flow',
        code: 'Client->Server: pay()\nServer-->Client: receipt',
        isNew: false,
        id: 'cc-123456',
      })
      return { template: '<story />' }
    },
  ],
}

// ---------------------------------------------------------------------------
// Mermaid tab active
// ---------------------------------------------------------------------------

/**
 * Mermaid diagram type selected — the middle tab is highlighted in emerald.
 */
export const MermaidDiagram: Story = {
  decorators: [
    () => {
      setupStore({
        diagramType: DiagramType.Mermaid,
        title: 'System Architecture',
        mermaidCode: 'graph TD\n  A[Client] --> B[Server]\n  B --> C[(DB)]',
        isNew: false,
        id: 'cc-234567',
      })
      return { template: '<story />' }
    },
  ],
}

// ---------------------------------------------------------------------------
// PlantUML tab active
// ---------------------------------------------------------------------------

/**
 * PlantUML diagram type selected — the third tab is active.
 */
export const PlantUmlDiagram: Story = {
  decorators: [
    () => {
      setupStore({
        diagramType: DiagramType.PlantUml,
        title: 'Class Diagram',
        plantUmlCode: '@startuml\nclass User\nclass Order\nUser "1" --> "*" Order\n@enduml',
        isNew: false,
        id: 'cc-345678',
      })
      return { template: '<story />' }
    },
  ],
}

// ---------------------------------------------------------------------------
// New diagram (isNew = true, no id yet)
// ---------------------------------------------------------------------------

/**
 * Brand-new diagram before first save. The mounted lifecycle reads
 * localStorage for a preferred diagram type; the title is blank and
 * Publish is disabled.
 */
export const NewDiagram: Story = {
  decorators: [
    () => {
      setupStore({
        diagramType: DiagramType.Sequence,
        title: '',
        isNew: true,
        id: '',
      })
      return { template: '<story />' }
    },
  ],
}
