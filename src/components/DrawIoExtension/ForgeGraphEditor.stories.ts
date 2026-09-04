import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import ForgeGraphEditor from './ForgeGraphEditor.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { useAutoTitle } from '@/composables/useAutoTitle'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'

setup((app: App) => {
  app.use(store)
})

type Story = StoryObj<typeof ForgeGraphEditor>

const EMPTY_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

const LABELLED_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="2" value="Login" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="3" value="Dashboard" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="280" y="80" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="4" edge="1" parent="1" source="2" target="3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

function clearDraftKeys() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('zenuml.draft.')) localStorage.removeItem(key)
  }
}

function setupForge() {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
}

function configureStory({
  title = '',
  graphXml = EMPTY_GRAPH,
  isNew = true,
  id = '',
}: {
  title?: string
  graphXml?: string
  isNew?: boolean
  id?: string
} = {}) {
  clearDraftKeys()
  setupForge()
  ;(useAutoTitle as any).__resetForTests?.()
  store.commit('updateDiagramType', DiagramType.Graph)
  store.commit('updateTitle', title)
  ;(store.state as any).diagram.isNew = isNew
  ;(store.state as any).diagram.id = id
  ;(store.state as any).diagram.graphXml = graphXml
}

async function mockSaveGraphAndExit() {
  return true
}

const meta: Meta<typeof ForgeGraphEditor> = {
  title: 'Editors/ForgeGraphEditor',
  component: ForgeGraphEditor,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Full DrawIO graph editor shell: bundled draw.io iframe, title overlay (DrawIoExtension), draft persistence hooks, and publish flow. Requires public/drawio static assets.',
      },
    },
  },
  decorators: [
    () => {
      configureStory()
      return { template: '<story />' }
    },
  ],
}

export default meta

/** Empty canvas on first open. */
export const Default: Story = {
  render: () => ({
    components: { ForgeGraphEditor },
    setup() {
      configureStory({ graphXml: EMPTY_GRAPH })
      return {
        graphXml: EMPTY_GRAPH,
        saveGraphAndExit: mockSaveGraphAndExit,
        doc: {},
      }
    },
    template:
      '<ForgeGraphEditor :graph-xml="graphXml" :save-graph-and-exit="saveGraphAndExit" :doc="doc" />',
  }),
}

/** Pre-labelled shapes loaded into the canvas. */
export const WithContent: Story = {
  render: () => ({
    components: { ForgeGraphEditor },
    setup() {
      configureStory({ graphXml: LABELLED_GRAPH, title: 'Login Flow' })
      return {
        graphXml: LABELLED_GRAPH,
        saveGraphAndExit: mockSaveGraphAndExit,
        doc: {},
      }
    },
    template:
      '<ForgeGraphEditor :graph-xml="graphXml" :save-graph-and-exit="saveGraphAndExit" :doc="doc" />',
  }),
}

/**
 * Real Sketch/Board iframe with the title mounted beside draw.io's Publish
 * control. This uses the production ForgeGraphEditor integration; it is not
 * a chrome mock.
 */
export const BoardWithContent: Story = {
  render: () => ({
    components: { ForgeGraphEditor },
    setup() {
      configureStory({ graphXml: LABELLED_GRAPH, title: 'Workshop map' })
      return {
        graphXml: LABELLED_GRAPH,
        boardGraphXml: LABELLED_GRAPH,
        saveGraphAndExit: mockSaveGraphAndExit,
        doc: {},
      }
    },
    template: '<ForgeGraphEditor :graph-xml="graphXml" :board-graph-xml="boardGraphXml" graph-editor-mode="board" :save-graph-and-exit="saveGraphAndExit" :doc="doc" />',
  }),
}
