// Root tsc uses legacy Node resolution; Storybook 10 exposes these through
// package exports. The Storybook/Vite build resolves them.
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { App } from 'vue'
import mixpanel from 'mixpanel-browser'
import DiagramPortal from '@/components/DiagramPortal.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'

setup((app: App) => {
  app.use(store)
})

type Story = StoryObj<typeof DiagramPortal>

const SEQUENCE_CODE = `title Checkout Flow
Client
Gateway
Inventory
Payment
Client.checkout(cart) {
  Gateway.reserve(cart) {
    Inventory.reserve(items)
  }
  Gateway.pay(total) {
    Payment.authorize(total)
  }
}`

const MERMAID_CODE = `flowchart LR
  Browser[Customer browser] --> Gateway[API gateway]
  Gateway --> Orders[Order service]
  Gateway --> Payments[Payment service]
  Orders --> Database[(Orders database)]
  Payments --> Provider[Payment provider]
  Orders --> Events{{Event stream}}
  Events --> Warehouse[Warehouse]
  Warehouse --> Courier[Courier integration]`

const PLANTUML_CODE = `@startuml
actor Customer
participant "API Gateway" as Gateway
participant "Order Service" as Orders
database "Orders DB" as Database
Customer -> Gateway: POST /orders
Gateway -> Orders: create order
Orders -> Database: save
Database --> Orders: order id
Orders --> Gateway: created
Gateway --> Customer: 201 Created
@enduml`

const PLANTUML_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 360" width="960" height="360">
  <rect width="960" height="360" fill="#fff"/>
  <g font-family="Arial, sans-serif" font-size="16" fill="#172b4d" stroke="#7a869a">
    <rect x="55" y="28" width="130" height="48" rx="6" fill="#deebff"/>
    <rect x="285" y="28" width="145" height="48" rx="6" fill="#eae6ff"/>
    <rect x="535" y="28" width="145" height="48" rx="6" fill="#e3fcef"/>
    <rect x="785" y="28" width="120" height="48" rx="6" fill="#fff0b3"/>
    <path d="M120 76v245M357 76v245M607 76v245M845 76v245" stroke-dasharray="5 5"/>
    <path d="M120 124h237l-10-6m10 6-10 6M357 177h250l-10-6m10 6-10 6M607 230h238l-10-6m10 6-10 6M845 283H120l10-6m-10 6 10 6" fill="none"/>
  </g>
  <g font-family="Arial, sans-serif" font-size="15" text-anchor="middle" fill="#172b4d">
    <text x="120" y="58">Customer</text><text x="357" y="58">API Gateway</text>
    <text x="607" y="58">Order Service</text><text x="845" y="58">Orders DB</text>
    <text x="238" y="115">POST /orders</text><text x="482" y="168">create order</text>
    <text x="726" y="221">save</text><text x="482" y="274">201 Created</text>
  </g>
</svg>`

const nativeFetch = globalThis.fetch

interface FullscreenFixture {
  diagramType: DiagramType
  typeLabel: string
  title: string
  code: string
  previewSelector: string
}

function installClipboardMock() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => undefined },
  })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  ;(document as any).execCommand = () => true
}

function configureFullscreen(fixture: FullscreenFixture) {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.isDiagramly = false
  forgeGlobal.isAsyncApi = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.invalid'
  forgeGlobal.forgeContext = {
    accountId: 'storybook-fullscreen-user',
    cloudId: 'storybook-cloud',
    environmentType: 'DEVELOPMENT',
    moduleKey: 'zenuml-sequence-macro',
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'DOCS' },
      config: { customContentId: `storybook-fullscreen-${fixture.diagramType}` },
      modal: { macroMode: 'fullscreen', diagramType: fixture.diagramType },
      macro: { isConfiguring: false, isInserting: false },
    },
  } as any

  globals.apWrapper.isDisplayMode = () => true
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.initializeContext = async () => undefined
  globals.apWrapper.getCurrentPage = async () => ({
    title: 'Storybook fullscreen page',
    body: { export_view: { value: '<p>Storybook fixture</p>' } },
    _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/DOCS/pages/1' },
  })

  localStorage.setItem('mockAgentLinkEnabled', 'false')
  installClipboardMock()
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop

  globalThis.fetch = fixture.diagramType === DiagramType.PlantUml
    ? async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://www.plantuml.com/plantuml/svg/')) {
          return new Response(PLANTUML_SVG, {
            status: 200,
            headers: { 'content-type': 'image/svg+xml' },
          })
        }
        return nativeFetch(input, init)
      }
    : nativeFetch

  store.commit('updateDiagramType', fixture.diagramType)
  store.commit('updateCode2', fixture.diagramType === DiagramType.Sequence ? fixture.code : '')
  store.commit('updateMermaidCode', fixture.diagramType === DiagramType.Mermaid ? fixture.code : '')
  store.commit('updatePlantUmlCode', fixture.diagramType === DiagramType.PlantUml ? fixture.code : '')
  store.commit('updateTitle', fixture.title)
  store.commit('updateMetadata', {})
  store.commit('updateError', null)
  store.commit('setPublishBlock', null)
  store.commit('setViewerLoadState', { viewerLoadState: 'ready' })
  store.commit('setDiagramAttribution', null)
  const diagram = (store.state as any).diagram
  diagram.id = `storybook-fullscreen-${fixture.diagramType}`
  diagram.isNew = false
  diagram.source = DataSource.CustomContent
  diagram.isCopy = false
  diagram.recoveredFromOrphan = false
  diagram.snapshotFallback = false
}

function renderFullscreen() {
  return {
    components: { DiagramPortal },
    template: '<DiagramPortal />',
  }
}

function fixtureDecorator(fixture: FullscreenFixture) {
  return () => {
    configureFullscreen(fixture)
    return { template: '<story />' }
  }
}

async function revealActions() {
  const surface = document.querySelector<HTMLElement>('.viewer-surface')
  if (!surface) throw new Error('Fullscreen viewer surface did not mount')
  await userEvent.hover(surface)
  await waitFor(() => {
    const actions = document.querySelector<HTMLElement>('.viewer-top-actions')
    if (!actions || getComputedStyle(actions).opacity !== '1') {
      throw new Error('Fullscreen viewer actions are not visible')
    }
  })
}

async function verifyFullscreen(fixture: FullscreenFixture) {
  const canvas = within(document.body)
  await expect(await canvas.findByText(fixture.title)).toBeVisible()
  await expect(await canvas.findByTestId('viewer-type-chip')).toHaveTextContent(fixture.typeLabel)

  await waitFor(() => {
    const preview = document.querySelector<HTMLElement>(fixture.previewSelector)
    const rect = preview?.getBoundingClientRect()
    if (!preview || !rect || rect.width <= 0 || rect.height <= 0) {
      throw new Error('Fullscreen diagram has no visible render area')
    }
  }, { timeout: 10000 })

  await revealActions()
  await expect(canvas.getByTestId('copy-for-ai-btn')).toBeVisible()
  await expect(canvas.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
  await expect(canvas.getByRole('button', { name: 'Export PNG' })).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Versions' })).toBeVisible()

  await userEvent.click(canvas.getByTestId('view-source-btn'))
  const sourcePanel = await canvas.findByTestId('view-source-panel')
  await expect(sourcePanel).toHaveClass('view-source-panel--fullscreen')
  await expect(canvas.getByTestId('view-source-code')).toHaveTextContent(fixture.code)
  await userEvent.click(canvas.getByTestId('view-source-close'))
  await waitFor(() => expect(canvas.queryByTestId('view-source-panel')).toBeNull())
}

const meta: Meta<typeof DiagramPortal> = {
  title: 'Fullscreen/FullscreenViewer',
  component: DiagramPortal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The complete production Fullscreen viewer with real viewer chrome, actions, source panel, and renderer. Forge, persistence, analytics transport, and external rendering boundaries are isolated by the story harness.',
      },
    },
  },
  render: renderFullscreen,
}

export default meta

const sequenceFixture: FullscreenFixture = {
  diagramType: DiagramType.Sequence,
  typeLabel: 'Sequence',
  title: 'Sequence — Checkout flow',
  code: SEQUENCE_CODE,
  previewSelector: '.viewer-frame--fullscreen .sequence-diagram',
}

export const Sequence: Story = {
  name: 'Sequence — complete fullscreen',
  decorators: [fixtureDecorator(sequenceFixture)],
  play: async () => verifyFullscreen(sequenceFixture),
}

const mermaidFixture: FullscreenFixture = {
  diagramType: DiagramType.Mermaid,
  typeLabel: 'Mermaid',
  title: 'Mermaid — Commerce architecture',
  code: MERMAID_CODE,
  previewSelector: '.viewer-frame--fullscreen .mermaid-diagram svg',
}

export const Mermaid: Story = {
  name: 'Mermaid — complete fullscreen',
  loaders: [
    async () => {
      __resetMermaidLoaderForTests()
      const bundledMermaid = await import('mermaid')
      await loadMermaid({ importer: async () => bundledMermaid, retries: 0 })
      return {}
    },
  ],
  decorators: [fixtureDecorator(mermaidFixture)],
  play: async () => {
    await verifyFullscreen(mermaidFixture)
    const canvas = within(document.body)
    await expect(canvas.getByRole('toolbar', { name: 'Mermaid zoom controls' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Zoom out' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Fit to screen' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await waitFor(() => {
      const viewerCanvas = document.querySelector<HTMLElement>('.viewer-canvas')
      const viewport = document.querySelector<HTMLElement>('.mermaid-viewport')
      const svg = document.querySelector<SVGElement>('.mermaid-diagram svg')
      if (!viewerCanvas || !viewport || !svg) throw new Error('Mermaid fullscreen surface is missing')

      const canvasStyle = getComputedStyle(viewerCanvas)
      const availableHeight = viewerCanvas.getBoundingClientRect().height
        - Number.parseFloat(canvasStyle.paddingTop)
        - Number.parseFloat(canvasStyle.paddingBottom)
      const viewportHeight = viewport.getBoundingClientRect().height
      const svgHeight = svg.getBoundingClientRect().height
      if (Math.abs(viewportHeight - availableHeight) > 1 || Math.abs(svgHeight - viewportHeight) > 1) {
        throw new Error('Mermaid does not fill the fullscreen canvas')
      }
      if (getComputedStyle(viewport).backgroundColor !== 'rgba(0, 0, 0, 0)') {
        throw new Error('Mermaid fullscreen viewport creates a second canvas background')
      }
    })
  },
}

const plantUmlFixture: FullscreenFixture = {
  diagramType: DiagramType.PlantUml,
  typeLabel: 'PlantUML',
  title: 'PlantUML — Order creation',
  code: PLANTUML_CODE,
  previewSelector: '.viewer-frame--fullscreen .plantuml-render svg',
}

export const PlantUML: Story = {
  name: 'PlantUML — complete fullscreen',
  decorators: [fixtureDecorator(plantUmlFixture)],
  play: async () => verifyFullscreen(plantUmlFixture),
}
