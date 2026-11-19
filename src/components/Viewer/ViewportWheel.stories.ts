import type { App } from 'vue'
import { defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import Mermaid from '@/components/Mermaid.vue'
import Sequence from '@/components/Sequence.vue'
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer'

setup((app: App) => app.use(store))

/**
 * Wheel, pinch, pan and zoom limits on each of the three surfaces.
 *
 * | Surface    | Plain wheel        | Shift / sideways | Ctrl/Cmd, pinch |
 * |------------|--------------------|------------------|-----------------|
 * | viewer     | scrolls the page   | scrolls the page | zoom at pointer |
 * | editor     | zoom at pointer    | pan              | zoom at pointer |
 * | fullscreen | zoom at pointer    | pan              | zoom at pointer |
 *
 * Zoom range: opening size up to natural size. A diagram edge never comes
 * inside the box edge. The viewer story sits in a tall page so a plain wheel
 * has a page to scroll.
 */
type Surface = 'viewer' | 'editor' | 'fullscreen'
type Kind = 'mermaid' | 'sequence' | 'graph'

const MERMAID = `flowchart LR
  A[Receive the order] --> B{Stock available?}
  B -->|yes| C[Reserve stock]
  B -->|no| D[Back-order the item]
  C --> E[Take payment]
  E --> F[Pick and pack]
  F --> G[Hand to the carrier]
  D --> H[Notify the customer]
  G --> I([Delivered])
  H --> I`

const SEQUENCE = `title Checkout and payment
Client->OrderService.placeOrder(cart) {
  Inventory.reserve(items)
  PaymentGateway.charge(card) {
    Bank.authorise(amount)
  }
  if(approved) {
    Warehouse.ship(order)
  }
}`

const GRAPH = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="API gateway" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dbeafe;" vertex="1" parent="1"><mxGeometry x="40" y="60" width="160" height="60" as="geometry"/></mxCell>
  <mxCell id="b" value="Order service" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dcfce7;" vertex="1" parent="1"><mxGeometry x="320" y="60" width="160" height="60" as="geometry"/></mxCell>
  <mxCell id="c" value="Payment service" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fee2e2;" vertex="1" parent="1"><mxGeometry x="600" y="60" width="160" height="60" as="geometry"/></mxCell>
  <mxCell id="d" value="Orders DB" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="350" y="220" width="100" height="80" as="geometry"/></mxCell>
  <mxCell id="f" value="Fraud check" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fef9c3;" vertex="1" parent="1"><mxGeometry x="900" y="60" width="160" height="60" as="geometry"/></mxCell>
  <mxCell id="g" value="Ledger" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ede9fe;" vertex="1" parent="1"><mxGeometry x="1200" y="60" width="160" height="60" as="geometry"/></mxCell>
  <mxCell id="h" value="Reporting" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e0f2fe;" vertex="1" parent="1"><mxGeometry x="1500" y="220" width="160" height="60" as="geometry"/></mxCell>
  <mxCell id="e4" edge="1" parent="1" source="c" target="f"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e5" edge="1" parent="1" source="f" target="g"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e6" edge="1" parent="1" source="g" target="h"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e1" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e2" edge="1" parent="1" source="b" target="c"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e3" edge="1" parent="1" source="b" target="d"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`

function useSurface(surface: Surface, kind: Kind) {
  const ready = ref(false)
  const previous = {
    forgeContext: forgeGlobal.forgeContext,
    isDisplayMode: globals.apWrapper.isDisplayMode,
    diagram: { ...(store.state as any).diagram },
  }
  onMounted(async () => {
    forgeGlobal.forgeContext = {
      accountId: 'storybook-wheel-user',
      extension: { content: { id: 'storybook-wheel' }, config: {}, ...(surface === 'fullscreen' ? { modal: { macroMode: 'fullscreen' } } : {}) },
    } as any
    globals.apWrapper.isDisplayMode = () => surface !== 'editor'
    if (kind === 'mermaid') {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit('updateMermaidCode', MERMAID)
    } else if (kind === 'sequence') {
      store.commit('updateDiagramType', DiagramType.Sequence)
      store.commit('updateCode2', SEQUENCE)
    } else {
      store.commit('updateDiagramType', DiagramType.Graph)
      Object.assign((store.state as any).diagram, { graphXml: GRAPH, source: DataSource.CustomContent, id: 'storybook-wheel', isNew: false })
      await ensureDrawioViewerLoaded()
    }
    ready.value = true
  })
  onUnmounted(() => {
    forgeGlobal.forgeContext = previous.forgeContext
    globals.apWrapper.isDisplayMode = previous.isDisplayMode
    Object.assign((store.state as any).diagram, previous.diagram)
  })
  return ready
}

function harness(surface: Surface, kind: Kind) {
  return defineComponent({
    setup() {
      const ready = useSurface(surface, kind)
      const body = () => {
        if (!ready.value) return h('p', 'Loading…')
        if (kind === 'mermaid') return h(Mermaid)
        if (kind === 'sequence') return h(Sequence)
        return h(ForgeGraphViewer)
      }
      return () => {
        // Editor preview: a fixed-height pane. Fullscreen: the viewport sets its
        // own height. Viewer: in a tall page so a plain wheel has somewhere to go.
        if (surface === 'editor') {
          return h('div', { 'data-surface': surface, style: 'height:520px;width:900px;border:1px solid #ccc' }, [body()])
        }
        if (surface === 'fullscreen') {
          return h('div', { 'data-surface': surface, style: 'width:1100px;border:1px solid #ccc' }, [body()])
        }
        return h('div', { 'data-surface': surface, style: 'width:640px' }, [
          h('p', { style: 'height:400px' }, 'Page text above the macro.'),
          h('div', { style: 'border:1px solid #ccc' }, [body()]),
          h('p', { style: 'height:1600px' }, 'Page text below the macro.'),
        ])
      }
    },
  })
}

const meta: Meta = {
  title: 'Viewer/ViewportWheel',
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj
const story = (surface: Surface, kind: Kind): Story => ({
  name: `${kind} — ${surface}`,
  render: () => ({ components: { Harness: harness(surface, kind) }, template: '<Harness />' }),
})

export const MermaidViewer = story('viewer', 'mermaid')
export const MermaidEditor = story('editor', 'mermaid')
export const MermaidFullscreen = story('fullscreen', 'mermaid')
export const SequenceViewer = story('viewer', 'sequence')
export const SequenceEditor = story('editor', 'sequence')
export const SequenceFullscreen = story('fullscreen', 'sequence')
export const GraphViewer = story('viewer', 'graph')
export const GraphEditor = story('editor', 'graph')
export const GraphFullscreen = story('fullscreen', 'graph')
