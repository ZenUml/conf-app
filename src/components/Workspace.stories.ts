// Root tsc uses legacy Node resolution; Storybook 10 exposes these through
// package exports. The Storybook/Vite build resolves them.
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { App } from 'vue'
import mixpanel from 'mixpanel-browser'
import Workspace from './Workspace.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { view as forgeView } from '@/stubs/forge-bridge'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'

setup((app: App) => {
  app.use(store)
})

type Story = StoryObj<typeof Workspace>

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
  Events --> Warehouse[Warehouse]`

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

const PLANTUML_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 300" width="720" height="300">
  <rect width="720" height="300" fill="#fff"/>
  <g font-family="Arial, sans-serif" font-size="15" fill="#172b4d" stroke="#7a869a">
    <rect x="30" y="22" width="110" height="42" rx="6" fill="#deebff"/>
    <rect x="205" y="22" width="125" height="42" rx="6" fill="#eae6ff"/>
    <rect x="395" y="22" width="125" height="42" rx="6" fill="#e3fcef"/>
    <rect x="585" y="22" width="105" height="42" rx="6" fill="#fff0b3"/>
    <path d="M85 64v205M267 64v205M457 64v205M637 64v205" stroke-dasharray="5 5"/>
    <path d="M85 104h182l-10-6m10 6-10 6M267 145h190l-10-6m10 6-10 6M457 186h180l-10-6m10 6-10 6M637 227H85l10-6m-10 6 10 6" fill="none"/>
  </g>
  <g font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#172b4d">
    <text x="85" y="48">Customer</text><text x="267" y="48">API Gateway</text>
    <text x="457" y="48">Order Service</text><text x="637" y="48">Orders DB</text>
    <text x="176" y="96">POST /orders</text><text x="362" y="137">create order</text>
    <text x="547" y="178">save</text><text x="362" y="219">201 Created</text>
  </g>
</svg>`

const nativeFetch = globalThis.fetch

interface EditorFixture {
  diagramType: DiagramType
  tabLabel: string
  title: string
  code: string
  previewSelector: string
  codeNeedle: string
}

function stubRuntime(fixture: EditorFixture) {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.isDiagramly = false
  forgeGlobal.isAsyncApi = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.invalid'
  forgeGlobal.forgeContext = {
    accountId: 'storybook-editor-user',
    cloudId: 'storybook-cloud',
    environmentType: 'DEVELOPMENT',
    moduleKey: 'zenuml-sequence-macro',
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'DOCS' },
      config: { customContentId: `storybook-${fixture.diagramType}` },
      modal: { macroMode: 'editor', diagramType: fixture.diagramType },
      macro: { isConfiguring: true, isInserting: false },
    },
  } as any

  globals.apWrapper.isDisplayMode = () => false
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.initializeContext = async () => undefined
  globals.apWrapper.getCurrentPage = async () => ({
    title: 'Storybook editor page',
    body: { export_view: { value: '<p>Storybook fixture</p>' } },
    _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/DOCS/pages/1' },
  })

  ;(forgeView as any).onClose = async () => undefined
  ;(window as any).split = true
  localStorage.setItem('mockAiChatEnabled', 'true')
  localStorage.removeItem('zenuml-preferred-diagram-type')

  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop

  store.commit('updateDiagramType', fixture.diagramType)
  store.commit('updateCode2', fixture.diagramType === DiagramType.Sequence ? fixture.code : '')
  store.commit('updateMermaidCode', fixture.diagramType === DiagramType.Mermaid ? fixture.code : '')
  store.commit('updatePlantUmlCode', fixture.diagramType === DiagramType.PlantUml ? fixture.code : '')
  store.commit('updateTitle', fixture.title)
  store.commit('updateMetadata', {})
  store.commit('updateError', null)
  store.commit('setPublishBlock', null)
  const diagram = (store.state as any).diagram
  diagram.id = `storybook-${fixture.diagramType}`
  diagram.isNew = false
  diagram.typeRequested = true
  diagram.source = DataSource.CustomContent
  diagram.updatedAt = '2026-09-10T00:00:00.000Z'

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
}

function renderEditor() {
  return {
    components: { Workspace },
    template: '<Workspace />',
  }
}

function storyDecorator(fixture: EditorFixture) {
  return () => {
    stubRuntime(fixture)
    return { template: '<story />' }
  }
}

async function verifyFullEditor(fixture: EditorFixture) {
  const canvas = within(document.body)
  await expect(await canvas.findByDisplayValue(fixture.title)).toBeVisible()
  await expect(canvas.getByRole('tab', { name: fixture.tabLabel })).toHaveAttribute('aria-selected', 'true')
  await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled()

  await waitFor(() => {
    const editor = document.querySelector<HTMLElement>('#workspace-left .cm-content')
    if (!editor?.textContent?.includes(fixture.codeNeedle)) {
      throw new Error('real CodeMirror editor has not loaded the fixture DSL')
    }
  })
  await waitFor(() => {
    const preview = document.querySelector<HTMLElement>(fixture.previewSelector)
    if (!preview) throw new Error('real diagram preview has not rendered')
  }, { timeout: 10000 })

  const leftPane = document.querySelector<HTMLElement>('#workspace-left')
  const rightPane = document.querySelector<HTMLElement>('#workspace-right')
  await expect(leftPane).toBeVisible()
  await expect(rightPane).toBeVisible()
  await expect(document.querySelector('.gutter.gutter-horizontal')).not.toBeNull()

  const chatToggle = await canvas.findByTestId('ai-chat-toggle')
  await userEvent.click(chatToggle)
  await expect(await canvas.findByTestId('ai-chat-panel')).toBeVisible()
  await expect(leftPane).not.toBeVisible()
  await userEvent.click(canvas.getByTestId('ai-chat-close'))
  await waitFor(() => expect(canvas.queryByTestId('ai-chat-panel')).toBeNull())
  await expect(leftPane).toBeVisible()
}

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/Workspace',
  component: Workspace,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The complete production Diagram Editor shell: title and type toolbar, CodeMirror DSL editor, draggable preview split, real renderer, syntax surfaces, AI Chat, Templates, Help, and Publish state. Platform and network boundaries are stubbed for Storybook.',
      },
    },
  },
  render: renderEditor,
}

export default meta

const sequenceFixture: EditorFixture = {
  diagramType: DiagramType.Sequence,
  tabLabel: 'Sequence',
  title: 'Sequence — Checkout flow',
  code: SEQUENCE_CODE,
  previewSelector: '#workspace-right .sequence-diagram',
  codeNeedle: 'checkout(cart)',
}

export const Sequence: Story = {
  name: 'Sequence — full editor',
  decorators: [storyDecorator(sequenceFixture)],
  play: async () => verifyFullEditor(sequenceFixture),
}

const mermaidFixture: EditorFixture = {
  diagramType: DiagramType.Mermaid,
  tabLabel: 'Mermaid',
  title: 'Mermaid — Commerce architecture',
  code: MERMAID_CODE,
  previewSelector: '#workspace-right .mermaid-diagram svg',
  codeNeedle: 'Customer browser',
}

export const Mermaid: Story = {
  name: 'Mermaid — full editor',
  loaders: [
    async () => {
      __resetMermaidLoaderForTests()
      const bundledMermaid = await import('mermaid')
      await loadMermaid({ importer: async () => bundledMermaid, retries: 0 })
      return {}
    },
  ],
  decorators: [storyDecorator(mermaidFixture)],
  play: async () => {
    await verifyFullEditor(mermaidFixture)
    const canvas = within(document.body)
    await expect(canvas.getByRole('toolbar', { name: 'Mermaid zoom controls' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Zoom out' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  },
}

const plantUmlFixture: EditorFixture = {
  diagramType: DiagramType.PlantUml,
  tabLabel: 'PlantUML',
  title: 'PlantUML — Order creation',
  code: PLANTUML_CODE,
  previewSelector: '#workspace-right .plantuml-render svg',
  codeNeedle: 'Order Service',
}

export const PlantUML: Story = {
  name: 'PlantUML — full editor',
  decorators: [storyDecorator(plantUmlFixture)],
  play: async () => verifyFullEditor(plantUmlFixture),
}
