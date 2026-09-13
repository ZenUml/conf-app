import type { App } from 'vue'
import { onMounted, onUnmounted, ref } from 'vue'
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, waitFor, within } from 'storybook/test'
import ForgeGraphViewer from './ForgeGraphViewer.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer'

setup((app: App) => app.use(store))

type Story = StoryObj<typeof ForgeGraphViewer>

const TWO_PAGE_GRAPH = `<mxfile>
  <diagram name="Page 1 — Orders">
    <mxGraphModel pageWidth="827" pageHeight="1169"><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="orders-title" value="ORDERS PAGE 1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dbeafe;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="240" height="70" as="geometry"/></mxCell>
      <mxCell id="orders-detail" value="Current orders" vertex="1" parent="1"><mxGeometry x="80" y="210" width="180" height="50" as="geometry"/></mxCell>
    </root></mxGraphModel>
  </diagram>
  <diagram name="Page 2 — Fulfilment">
    <mxGraphModel pageWidth="827" pageHeight="1169"><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="fulfilment-title" value="FULFILMENT PAGE 2" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dcfce7;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="260" height="70" as="geometry"/></mxCell>
      <mxCell id="fulfilment-detail" value="Dispatch queue" vertex="1" parent="1"><mxGeometry x="80" y="210" width="180" height="50" as="geometry"/></mxCell>
    </root></mxGraphModel>
  </diagram>
</mxfile>`

const WIDE_GRAPH = `<mxfile>
  <diagram name="Wide canvas">
    <mxGraphModel pageWidth="3000" pageHeight="1200"><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="wide-left" value="FAR LEFT NODE" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dbeafe;" vertex="1" parent="1"><mxGeometry x="40" y="180" width="260" height="80" as="geometry"/></mxCell>
      <mxCell id="wide-right" value="FAR RIGHT NODE" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fee2e2;" vertex="1" parent="1"><mxGeometry x="2600" y="180" width="300" height="80" as="geometry"/></mxCell>
      <mxCell id="wide-edge" edge="1" parent="1" source="wide-left" target="wide-right"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>
  </diagram>
</mxfile>`

const meta: Meta<typeof ForgeGraphViewer> = {
  title: 'Viewer/ForgeGraphViewer',
  component: ForgeGraphViewer,
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Production GraphViewer renderer with real DrawIO GraphViewer assets and multi-page export navigation.' } },
  },
}

export default meta

function useRealGraphFixture({
  graphXml,
  title,
  accountId,
  contentId,
}: {
  graphXml: string
  title: string
  accountId: string
  contentId: string
}) {
  const ready = ref(false)
  const previousForge = {
    isForge: forgeGlobal.isForge,
    isLite: forgeGlobal.isLite,
    forgeContext: forgeGlobal.forgeContext,
  }
  const previousWrapper = {
    isDisplayMode: globals.apWrapper.isDisplayMode,
    canUserEdit: globals.apWrapper.canUserEdit,
    initializeContext: globals.apWrapper.initializeContext,
  }
  const previousDiagram = { ...(store.state as any).diagram }

  onMounted(async () => {
    forgeGlobal.isForge = false
    forgeGlobal.isLite = true
    forgeGlobal.forgeContext = { accountId, extension: { content: { id: contentId }, config: {}, modal: { macroMode: 'fullscreen' } } } as any
    globals.apWrapper.isDisplayMode = () => true
    globals.apWrapper.canUserEdit = async () => true
    globals.apWrapper.initializeContext = async () => undefined
    store.commit('updateDiagramType', DiagramType.Graph)
    store.commit('updateTitle', title)
    Object.assign((store.state as any).diagram, { graphXml, source: DataSource.CustomContent, id: contentId, isNew: false })
    await ensureDrawioViewerLoaded()
    ready.value = true
  })

  onUnmounted(() => {
    forgeGlobal.isForge = previousForge.isForge
    forgeGlobal.isLite = previousForge.isLite
    forgeGlobal.forgeContext = previousForge.forgeContext
    globals.apWrapper.isDisplayMode = previousWrapper.isDisplayMode
    globals.apWrapper.canUserEdit = previousWrapper.canUserEdit
    globals.apWrapper.initializeContext = previousWrapper.initializeContext
    Object.assign((store.state as any).diagram, previousDiagram)
  })

  return { ready, graphXml }
}

export const RealTwoPageExport: Story = {
  name: 'Real GraphViewer — two-page export bounds',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture({ graphXml: TWO_PAGE_GRAPH, title: 'Two-page Graph export', accountId: 'storybook-graph-user', contentId: 'storybook-graph-content' })
    },
    template: '<div style="width:1200px;height:760px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('ORDERS PAGE 1')
      expect(canvasElement.textContent).toContain('1 / 2')
    }, { timeout: 15000 })
    await expect(canvas.getByRole('button', { name: 'Next page' })).toBeEnabled()

    canvas.getByRole('button', { name: 'Next page' }).click()
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('FULFILMENT PAGE 2')
      expect(canvasElement.textContent).toContain('2 / 2')
    })
    await expect(canvas.getByRole('button', { name: 'Previous page' })).toBeEnabled()

    canvas.getByRole('button', { name: 'Export PNG' }).click()
    await waitFor(() => {
      const pageTwoPreview = canvasElement.querySelector<HTMLImageElement>('img[alt="Diagram preview"]')
      if (!pageTwoPreview) throw new Error('page 2 export preview has not mounted')
      expect(pageTwoPreview.src).toMatch(/^data:image\/png/)
      expect(pageTwoPreview.naturalWidth).toBe(562)
      expect(pageTwoPreview.naturalHeight).toBe(402)
    }, { timeout: 15000 })
    canvas.getByRole('button', { name: 'Close export' }).click()

    canvas.getByRole('button', { name: 'Previous page' }).click()
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('ORDERS PAGE 1')
      expect(canvasElement.textContent).toContain('1 / 2')
    })
    canvas.getByRole('button', { name: 'Export PNG' }).click()
    await waitFor(() => {
      const pageOnePreview = canvasElement.querySelector<HTMLImageElement>('img[alt="Diagram preview"]')
      if (!pageOnePreview) throw new Error('page 1 export preview has not mounted')
      expect(pageOnePreview.src).toMatch(/^data:image\/png/)
      expect(pageOnePreview.naturalWidth).toBe(522)
      expect(pageOnePreview.naturalHeight).toBe(402)
    }, { timeout: 15000 })
  },
}

export const RealWideGraphExport: Story = {
  name: 'Real GraphViewer — wide non-unit-scale export',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture({ graphXml: WIDE_GRAPH, title: 'Wide Graph export', accountId: 'storybook-wide-graph-user', contentId: 'storybook-wide-graph-content' })
    },
    template: '<div style="width:900px;height:620px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('FAR LEFT NODE')
      expect(canvasElement.textContent).toContain('FAR RIGHT NODE')
    }, { timeout: 15000 })
    const capture = canvasElement.querySelector<HTMLElement>('.graph-viewer-canvas')
    if (!capture) throw new Error('wide GraphViewer capture root has not mounted')
    expect(Number(capture.dataset.captureBoxWidth)).toBeGreaterThan(800)
    canvas.getByRole('button', { name: 'Export PNG' }).click()
    await waitFor(() => {
      const preview = canvasElement.querySelector<HTMLImageElement>('img[alt="Diagram preview"]')
      if (!preview) throw new Error('wide graph export preview has not mounted')
      expect(preview.src).toMatch(/^data:image\/png/)
      expect(preview.naturalWidth).toBe(1698)
      expect(preview.naturalHeight).toBe(88)
    }, { timeout: 15000 })
  },
}

export const RealGraphPanZoom: Story = {
  name: 'Real GraphViewer — pan and zoom',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture({ graphXml: WIDE_GRAPH, title: 'Wide Graph zoom', accountId: 'storybook-zoom-graph-user', contentId: 'storybook-zoom-graph-content' })
    },
    template: '<div style="width:900px;height:620px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('FAR LEFT NODE')
    }, { timeout: 15000 })

    const container = canvasElement.querySelector<HTMLElement>('.graph-viewer-canvas')!
    // mxGraph keeps the zoom on graph.view; the drawn SVG is its visible trace, so
    // measure that rather than reaching into GraphViewer's internals.
    const readScale = () => container.querySelector('svg')!.getBoundingClientRect().width

    await expect(canvas.getByRole('toolbar', { name: 'Graph zoom controls' })).toBeVisible()
    const before = readScale()
    const beforeHeight = container.getBoundingClientRect().height

    canvas.getByRole('button', { name: 'Zoom in' }).click()
    await waitFor(() => {
      expect(readScale()).toBeGreaterThan(before)
    })
    // The container must NOT grow with the zoom: that is what GraphViewer's own
    // `zoomEnabled` toolbar would do, and it would push the page around.
    expect(Math.round(container.getBoundingClientRect().height)).toBe(Math.round(beforeHeight))

    canvas.getByRole('button', { name: 'Zoom out' }).click()
    await waitFor(() => {
      expect(readScale()).toBeLessThanOrEqual(before + 1)
    })
  },
}
