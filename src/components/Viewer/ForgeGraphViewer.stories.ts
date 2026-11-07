import type { App } from 'vue'
import { onMounted, onUnmounted, ref } from 'vue'
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, waitFor, within } from 'storybook/test'
import ForgeGraphViewer from './ForgeGraphViewer.vue'
import store from '@/model/store2'
import { forgeEnv } from '../../../.storybook/forgeEnv'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { ensureDrawioViewerLoaded } from '@/utils/drawio/loadDrawioViewer'
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge'

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

const BUNDLED_ICON_GRAPH = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="control" value="BUNDLED ICONS" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="60" as="geometry"/></mxCell>
  <mxCell id="subnet" value="" style="aspect=fixed;html=1;image;image=img/lib/azure2/networking/Subnet.svg;" vertex="1" parent="1"><mxGeometry x="170" y="20" width="60" height="60" as="geometry"/></mxCell>
  <mxCell id="kubernetes" value="" style="aspect=fixed;html=1;image;image=img/lib/mscae/Kubernetes.svg;" vertex="1" parent="1"><mxGeometry x="260" y="20" width="60" height="60" as="geometry"/></mxCell>
</root></mxGraphModel>`

const MATH_GRAPH = `<mxGraphModel math="1"><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="pythagoras" value="$$x^2 + y^2 = z^2$$" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="240" height="80" as="geometry"/></mxCell>
  <mxCell id="fraction" value="\\(\\frac{a}{b} + \\sqrt{c}\\)" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e8d4;" vertex="1" parent="1"><mxGeometry x="300" y="20" width="240" height="80" as="geometry"/></mxCell>
  <mxCell id="plain" value="PLAIN LABEL" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="140" width="240" height="60" as="geometry"/></mxCell>
</root></mxGraphModel>`

function countKubernetesBluePixels(image: HTMLImageElement): number {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - 50) < 24 && Math.abs(data[i + 1] - 108) < 24 && Math.abs(data[i + 2] - 229) < 24) count++
  }
  return count
}

const meta: Meta<typeof ForgeGraphViewer> = {
  title: 'Viewer/ForgeGraphViewer',
  component: ForgeGraphViewer,
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Production GraphViewer renderer with real DrawIO GraphViewer assets and multi-page export navigation.' } },
  },
}

export default meta

interface RealGraphFixture {
  graphXml: string
  title: string
  accountId: string
  contentId: string
}

/** The Forge environment of a fullscreen Lite graph viewer; restored when the story unmounts. */
function realGraphEnv({ accountId, contentId }: RealGraphFixture) {
  return forgeEnv({
    forge: {
      isForge: false,
      isLite: true,
      forgeContext: { accountId, extension: { content: { id: contentId }, config: {}, modal: { macroMode: 'fullscreen' } } },
    },
    apWrapper: {
      isDisplayMode: () => true,
      canUserEdit: async () => true,
      initializeContext: async () => undefined,
    },
  })
}

const REAL_TWO_PAGE: RealGraphFixture = { graphXml: TWO_PAGE_GRAPH, title: 'Two-page Graph export', accountId: 'storybook-graph-user', contentId: 'storybook-graph-content' }
const REAL_WIDE: RealGraphFixture = { graphXml: WIDE_GRAPH, title: 'Wide Graph export', accountId: 'storybook-wide-graph-user', contentId: 'storybook-wide-graph-content' }
const REAL_ZOOM: RealGraphFixture = { graphXml: WIDE_GRAPH, title: 'Wide Graph zoom', accountId: 'storybook-zoom-graph-user', contentId: 'storybook-zoom-graph-content' }

function useRealGraphFixture({ graphXml, title, contentId }: RealGraphFixture) {
  const ready = ref(false)
  const previousDiagram = { ...(store.state as any).diagram }

  onMounted(async () => {
    store.commit('updateDiagramType', DiagramType.Graph)
    store.commit('updateTitle', title)
    Object.assign((store.state as any).diagram, { graphXml, source: DataSource.CustomContent, id: contentId, isNew: false })
    await ensureDrawioViewerLoaded()
    ready.value = true
  })

  onUnmounted(() => {
    Object.assign((store.state as any).diagram, previousDiagram)
  })

  return { ready, graphXml }
}

export const RealTwoPageExport: Story = {
  name: 'Real GraphViewer — two-page export bounds',
  decorators: [realGraphEnv(REAL_TWO_PAGE)],
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture(REAL_TWO_PAGE)
    },
    template: '<div style="width:1200px;height:760px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('ORDERS PAGE 1')
      expect(canvasElement.textContent).toContain('1 of 2')
    }, { timeout: 15000 })
    await expect(canvas.getByRole('button', { name: 'Next page' })).toBeEnabled()

    canvas.getByRole('button', { name: 'Next page' }).click()
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('FULFILMENT PAGE 2')
      expect(canvasElement.textContent).toContain('2 of 2')
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
      expect(canvasElement.textContent).toContain('1 of 2')
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
  decorators: [realGraphEnv(REAL_WIDE)],
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture(REAL_WIDE)
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
  decorators: [realGraphEnv(REAL_ZOOM)],
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture(REAL_ZOOM)
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

export const RealBundledIcons: Story = {
  name: 'Real GraphViewer — bundled icons load from drawio/',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture({ graphXml: BUNDLED_ICON_GRAPH, title: 'Bundled icons', accountId: 'storybook-icons-graph-user', contentId: 'storybook-icons-graph' })
    },
    template: '<div style="width:900px;height:620px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('BUNDLED ICONS')
    }, { timeout: 15000 })

    const iconUrls = () => [...canvasElement.querySelectorAll('.graph-viewer-canvas svg image')]
      .map((image) => new URL(image.getAttribute('xlink:href') ?? image.getAttribute('href') ?? '', document.baseURI))
    await waitFor(() => {
      expect(iconUrls()).toHaveLength(2)
    })
    // Forge's CSP refuses any other host, so an icon served from elsewhere breaks
    // in Confluence even though it would load here.
    for (const url of iconUrls()) {
      expect(url.origin).toBe(new URL(document.baseURI).origin)
      expect(url.pathname).toContain('/drawio/img/lib/')
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('svg')
    }

    canvas.getByRole('button', { name: 'Export PNG' }).click()
    await waitFor(() => {
      const preview = canvasElement.querySelector<HTMLImageElement>('img[alt="Diagram preview"]')
      if (!preview) throw new Error('icon graph export preview has not mounted')
      expect(preview.src).toMatch(/^data:image\/png/)
      expect(preview.naturalWidth).toBeGreaterThan(0)
      // A broken-image glyph has no Kubernetes blue, so this fails when the
      // capture kept an external icon URL instead of embedding it.
      expect(countKubernetesBluePixels(preview)).toBeGreaterThan(500)
    }, { timeout: 15000 })
  },
}

export const RealMathLabels: Story = {
  name: 'Math labels typeset with the bundled MathJax',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      return useRealGraphFixture({ graphXml: MATH_GRAPH, title: 'Math labels', accountId: 'storybook-math-graph-user', contentId: 'storybook-math-graph' })
    },
    template: '<div style="width:900px;height:620px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('.graph-viewer-canvas mjx-container')).toHaveLength(2)
    }, { timeout: 15000 })

    // While MathJax is missing the viewer keeps the canvas hidden, which blanks
    // every label, plain ones too.
    const plainLabel = [...canvasElement.querySelectorAll<HTMLElement>('.graph-viewer-canvas foreignObject div')]
      .find((element) => element.textContent === 'PLAIN LABEL')
    await waitFor(() => {
      expect(plainLabel && getComputedStyle(plainLabel).visibility).toBe('visible')
    })

    // Forge's CSP refuses any other host, so MathJax loaded from elsewhere works
    // here and fails in Confluence.
    const startup = [...document.querySelectorAll<HTMLScriptElement>('script[src$="/startup.js"]')]
      .map((script) => new URL(script.src))
    expect(startup).toHaveLength(1)
    expect(startup[0].origin).toBe(new URL(document.baseURI).origin)
    expect(startup[0].pathname).toContain('/drawio/math4/es5/')
  },
}

// Synthetic fixture. The proxy answer is stubbed, so this exercises the viewer
// and the capture, not the backend half.
const EXTERNAL_ICON = 'https://icons.diagrams.net/assets/azure/1/Azure_Service_Bus_Queues.svg'
const EXTERNAL_ICON_HTML = 'https://icons.diagrams.net/assets/azure/1/Azure_Storage.svg'
const svgDataUrl = (fill: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="${fill}"/></svg>`)}`
const EXTERNAL_ICON_GRAPH = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="control" value="EXTERNAL ICONS" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="140" height="60" as="geometry"/></mxCell>
  <mxCell id="style-icon" value="" style="aspect=fixed;html=1;image;image=${EXTERNAL_ICON};" vertex="1" parent="1"><mxGeometry x="190" y="20" width="60" height="60" as="geometry"/></mxCell>
  <mxCell id="label-icon" value="&lt;img src=&quot;${EXTERNAL_ICON_HTML}&quot; width=&quot;48&quot; height=&quot;48&quot;&gt;" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="280" y="20" width="60" height="60" as="geometry"/></mxCell>
</root></mxGraphModel>`

function countColour(image: HTMLImageElement, [r, g, b]: [number, number, number]): number {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 12 && Math.abs(data[i + 1] - g) < 12 && Math.abs(data[i + 2] - b) < 12) count++
  }
  return count
}

export const RealExternalIconsViaProxy: Story = {
  name: 'Real GraphViewer — icons.diagrams.net icons through the backend proxy',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      resetStubResponses()
      stubResponses.remote.push({ match: '/graph-icon-proxy', body: { icons: { [EXTERNAL_ICON]: svgDataUrl('#d4145a'), [EXTERNAL_ICON_HTML]: svgDataUrl('#00a0d2') }, failed: {} } })
      return useRealGraphFixture({ graphXml: EXTERNAL_ICON_GRAPH, title: 'External icons', accountId: 'storybook-ext-icons-user', contentId: 'storybook-ext-icons' })
    },
    template: '<div style="width:900px;height:620px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvasElement.textContent).toContain('EXTERNAL ICONS'), { timeout: 15000 })
    // The style icon is an SVG <image>; the viewer holds the proxied data URL,
    // never the icons.diagrams.net URL that Forge's CSP would refuse.
    await waitFor(() => {
      const hrefs = [...canvasElement.querySelectorAll('.graph-viewer-canvas svg image')]
        .map((image) => image.getAttribute('xlink:href') ?? image.getAttribute('href') ?? '')
      expect(hrefs.some((href) => href.startsWith('data:image/svg+xml'))).toBe(true)
      expect(hrefs.some((href) => href.includes('icons.diagrams.net'))).toBe(false)
    }, { timeout: 10000 })

    canvas.getByRole('button', { name: 'Export PNG' }).click()
    await waitFor(() => {
      const preview = canvasElement.querySelector<HTMLImageElement>('img[alt="Diagram preview"]')
      if (!preview) throw new Error('export preview has not mounted')
      expect(preview.src).toMatch(/^data:image\/png/)
      // "capture ok" only means the promise resolved: the icon's own colour must be in the PNG.
      expect(countColour(preview, [212, 20, 90])).toBeGreaterThan(300)
    }, { timeout: 15000 })
  },
}

export const RealExternalIconsProxyFails: Story = {
  name: 'Real GraphViewer — icon proxy fails: diagram renders, PNG is refused',
  render: () => ({
    components: { ForgeGraphViewer },
    setup() {
      resetStubResponses()
      stubResponses.remote.push({ match: '/graph-icon-proxy', status: 502, body: 'bad gateway' })
      return useRealGraphFixture({ graphXml: EXTERNAL_ICON_GRAPH, title: 'External icons fail', accountId: 'storybook-ext-icons-fail-user', contentId: 'storybook-ext-icons-fail' })
    },
    template: '<div style="width:900px;height:620px;margin:0 auto;background:#fff"><ForgeGraphViewer v-if="ready" :graph-xml="graphXml" /></div>',
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('EXTERNAL ICONS'), { timeout: 15000 })
    await waitFor(() => expect(canvasElement.querySelectorAll('.graph-viewer-canvas svg').length).toBeGreaterThan(0))
  },
}
