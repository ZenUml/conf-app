import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import Header from './Header.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'

// Header.vue reads the store through mapState/mapGetters, so the Vuex plugin is
// installed on Storybook's root Vue app via setup(). See GenericViewer.stories.ts
// for why the decorator `app:` idiom never worked on @storybook/vue3-vite 10.4.
setup((app: App) => {
  app.use(store)
})

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
  title: 'Editor/Diagram/Header',
  component: Header,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Top toolbar of the diagram editor (Workspace.vue): the diagram title input on the left, the Sequence / Mermaid / PlantUML tab strip in the centre notch, then AI Chat (when available), Templates (starter-template gallery), Help and Publish on the right. Publish is disabled until a title is provided; hovering the disabled button shows "Add a diagram title to publish".',
      },
    },
  },
  decorators: [
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
 * Hovering the Publish button reveals the "Add a diagram title to publish" tooltip.
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
 * Mermaid diagram type selected — the middle tab carries the Mermaid accent (#FF3670 underline and dot).
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
 * PlantUML diagram type selected — the third tab carries the PlantUML accent (#B84800).
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

// ---------------------------------------------------------------------------
// Auto-opened starter gallery (onboarding funnel)
// ---------------------------------------------------------------------------

/**
 * First entry to a brand-new, empty macro: the starter-template gallery
 * opens itself instead of showing a blank canvas (`template_gallery_trigger:
 * 'auto_first_open'`). Requires clearing the "already auto-opened" browser
 * marker (see utils/starterGallery/autoOpenMarker.ts) so the story always
 * demonstrates a first visit — in a real session this fires once per
 * cloudId + macro type per browser, never again after that.
 */
export const AutoOpenStarterGallery: Story = {
  decorators: [
    () => {
      localStorage.removeItem('zenuml.starterGalleryAutoOpened.unknown-cloud.sequence')
      setupStore({
        diagramType: DiagramType.Sequence,
        title: '',
        code: '',
        isNew: true,
        id: '',
      })
      return { template: '<story />' }
    },
  ],
}
