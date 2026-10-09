// Root tsc uses legacy Node resolution; Storybook/Vite resolves these exports.
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { expect, userEvent, waitFor, within } from 'storybook/test'
import mixpanel from 'mixpanel-browser'
import { FeatureFlags } from '@forge/bridge'
import ViewerCreateDiscovery from './__design__/ViewerCreateDiscovery.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { resetStubResponses } from '@/stubs/forge-bridge'

setup((app: { use(plugin: typeof store): unknown }) => app.use(store))

type Story = StoryObj<typeof ViewerCreateDiscovery>

const MERMAID_CODE = `flowchart LR
  Visitor[Customer] --> Checkout[Checkout]
  Checkout --> Payment[Payment service]
  Payment -->|Approved| Receipt[Receipt]
  Payment -->|Retry| Checkout`

const GRAPH_XML = `<mxfile><diagram name="Checkout flow"><mxGraphModel pageWidth="827" pageHeight="580"><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="cart" value="Cart" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#DEEBFF;strokeColor=#4C9AFF;fontColor=#172B4D;" vertex="1" parent="1"><mxGeometry x="65" y="130" width="150" height="60" as="geometry"/></mxCell>
  <mxCell id="checkout" value="Checkout" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#EAE6FF;strokeColor=#998DD9;fontColor=#172B4D;" vertex="1" parent="1"><mxGeometry x="335" y="130" width="150" height="60" as="geometry"/></mxCell>
  <mxCell id="payment" value="Payment" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#E3FCEF;strokeColor=#57D9A3;fontColor=#172B4D;" vertex="1" parent="1"><mxGeometry x="605" y="130" width="150" height="60" as="geometry"/></mxCell>
  <mxCell id="e1" edge="1" parent="1" source="cart" target="checkout"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e2" edge="1" parent="1" source="checkout" target="payment"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`

const OPENAPI_SPEC = `openapi: 3.0.0
info:
  title: Checkout API
  version: 1.0.0
paths:
  /orders:
    post:
      summary: Place an order
      responses:
        '201':
          description: Order created
  /payments/{id}:
    get:
      summary: Read a payment
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Payment found`

type Kind = 'mermaid' | 'graph' | 'openapi'

function configureStory(kind: Kind) {
  resetStubResponses()
  FeatureFlags.prototype.checkFlag = (_key: string, fallback = false) => fallback
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    extension: { content: { id: 'storybook-page' }, space: { key: 'DEMO' }, config: {} },
  } as any
  globals.apWrapper.isDisplayMode = () => true
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.initializeContext = async () => undefined
  globals.apWrapper.getCurrentPage = async () => ({
    title: 'Checkout architecture',
    body: { export_view: { value: '<p>Sample page for the Storybook design proposal.</p>' } },
    _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/DEMO/pages/123' },
  }) as any
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop
  store.commit('updateDiagramType', kind === 'graph' ? DiagramType.Graph : kind === 'openapi' ? DiagramType.OpenApi : DiagramType.Mermaid)
  store.commit('updateTitle', kind === 'graph' ? 'Checkout flow' : kind === 'openapi' ? 'Checkout API' : 'Checkout journey')
  store.commit('updateMermaidCode', kind === 'mermaid' ? MERMAID_CODE : '')
  store.commit('updateCode2', '')
  Object.assign((store.state as any).diagram, {
    source: DataSource.CustomContent,
    id: 'storybook-diagram',
    isNew: false,
    graphXml: kind === 'graph' ? GRAPH_XML : '',
    recoveredFromOrphan: false,
    snapshotFallback: false,
  })
  store.commit('setDiagramAttribution', null)
}

const meta: Meta<typeof ViewerCreateDiscovery> = {
  title: 'Design proposals/Viewer Create discovery',
  component: ViewerCreateDiscovery,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Design proposal only. The real viewers (Mermaid, DrawIO Graph, OpenAPI) are mounted, while the Create discovery action and compact header styling exist only in this Storybook story. Create stands in for a Forge `size: medium`, untitled modal (600 × 520, no Atlassian header) whose whole content is an eight-second, silent, looping slash-command guide served by the local Remotion review server on 127.0.0.1:5173. The guide carries its own hover/focus close button and Escape handler, as an untitled Forge modal requires. Nothing is created or written to Confluence.',
      },
    },
  },
}
export default meta

function render(kind: Kind, narrow = false) {
  return () => {
    configureStory(kind)
    return {
      components: { ViewerCreateDiscovery },
      setup() { return { kind, graphXml: GRAPH_XML, openApiSpec: OPENAPI_SPEC } },
      template: `
        <main :style="{ maxWidth: ${narrow ? "'400px'" : "'1040px'"}, width: '100%', margin: narrow ? '28px auto' : '42px auto', padding: narrow ? '0 8px' : '0 32px', boxSizing: 'border-box', color: '#172B4D', fontFamily: 'Arial, sans-serif' }">
          <div style="font-size:12px;color:#6B778C;margin-bottom:18px;">Product&nbsp; / &nbsp;Architecture</div>
          <h1 style="font-size:28px;line-height:1.25;letter-spacing:-.02em;margin:0 0 10px;font-weight:600;">Checkout architecture</h1>
          <p style="font-size:14px;color:#42526E;line-height:1.55;margin:0 0 26px;">The current customer and payment flow, documented for the team.</p>
          <ViewerCreateDiscovery :kind="kind" :graph-xml="graphXml" :open-api-spec="openApiSpec" />
        </main>
      `,
      data() { return { narrow } },
    }
  }
}

const GUIDE_ORIGIN = 'http://127.0.0.1:5173'

/**
 * Opens the guide and checks the Forge-modal shape: one iframe, no parent-side controls, 600 × 520 at a
 * desktop viewport. Then the two parent-side close paths Confluence provides: Escape while focus is on
 * the dialog element, and a blanket click. (The guide's own close button and Escape run inside the
 * cross-origin iframe; they are checked in the browser, not here.)
 */
async function checkGuideDialog(create: HTMLElement, title: string, guide: string) {
  await userEvent.click(create)
  const dialog = await within(document.body).findByRole('dialog', { name: 'Add a diagram with a slash command' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveFocus()
  await expect(within(dialog).getByTitle(title)).toHaveAttribute('src', `${GUIDE_ORIGIN}/?guide=${guide}&embed=1`)
  await expect(within(dialog).queryAllByRole('button')).toHaveLength(0)
  if (innerWidth >= 632 && innerHeight >= 596) {
    const box = dialog.getBoundingClientRect()
    await expect([Math.round(box.width), Math.round(box.height)]).toEqual([600, 520])
  }
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  await expect(create).toHaveFocus()

  await userEvent.click(create)
  const blanket = await within(document.body).findByTestId('custom-ui-modal-dialog--blanket')
  await userEvent.pointer({ keys: '[MouseLeft]', target: blanket, coords: { clientX: 4, clientY: 4 } })
  await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
}

/** Actual Mermaid rendering with the proposed always-visible Create action. */
export const MermaidViewer: Story = {
  name: 'Mermaid viewer · Create discovery',
  render: render('mermaid'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const create = await canvas.findByRole('button', { name: 'Create' })
    await expect(create).toBeVisible()
    const actions = canvasElement.querySelector<HTMLElement>('.viewer-top-actions')
    // The action row fades in on mount; wait for it rather than sampling mid-transition.
    await waitFor(() => expect(getComputedStyle(actions!).opacity).toBe('1'))
    const edit = canvas.getByRole('button', { name: 'Edit' })
    const source = canvas.getByRole('button', { name: 'Source' })
    await expect(getComputedStyle(edit.querySelector('span')!).display).toBe('none')
    await expect(getComputedStyle(source.querySelector('span')!).display).toBe('none')
    await expect(edit.getAttribute('title')).toBe('Edit diagram')
    await expect(source.getAttribute('title')).toBe('View source')

    await checkGuideDialog(create, 'ZenUML creation guide', 'zenuml')
  },
}

/** Real DrawIO Graph viewer inside the same production viewer chrome. */
export const GraphViewer: Story = {
  name: 'Graph viewer · Create discovery',
  render: render('graph'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const create = await canvas.findByRole('button', { name: 'Create' })
    await expect(create).toBeVisible()
    await checkGuideDialog(create, 'Graph creation guide', 'graph')
  },
}

/** Real Swagger UI OpenAPI viewer; Create opens the OpenAPI guide. */
export const OpenApiViewer: Story = {
  name: 'OpenAPI viewer · Create discovery',
  render: render('openapi'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const create = await canvas.findByRole('button', { name: 'Create' })
    await expect(create).toBeVisible()
    await checkGuideDialog(create, 'OpenAPI creation guide', 'api')
  },
}

/** A 400px macro: title and actions get separate lines; Create remains visible. */
export const NarrowViewer: Story = {
  name: 'Narrow 400px viewer',
  render: render('mermaid', true),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const create = await canvas.findByRole('button', { name: 'Create' })
    await expect(create).toBeVisible()
    const root = canvasElement.querySelector<HTMLElement>('.viewer-create-story')!
    const title = root.querySelector<HTMLElement>('.viewer-title-area')!
    const actions = root.querySelector<HTMLElement>('.viewer-top-actions')!
    await expect(actions.getBoundingClientRect().top).toBeGreaterThan(title.getBoundingClientRect().top)
    await expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth)
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  },
}
