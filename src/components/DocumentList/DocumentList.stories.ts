import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, waitFor, within } from 'storybook/test'
import type { App } from 'vue'
import DocumentList from './DocumentList.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'

// DocumentList.vue writes the picked diagram into `this.$store` and the preview
// it mounts (DiagramPortal → GenericViewer → renderer) reads the store, so the
// Vuex plugin has to be on Storybook's root Vue app. setup() is the framework's
// extension point — see GenericViewer.stories.ts.
setup((app: App) => {
  app.use(store)
})

/**
 * The Embed macro's editor. ForgeEmbedEditor.vue renders DocumentList.vue, which
 * lists every diagram stored as Confluence custom content (grouped by page),
 * filters by type and keyword, previews the picked one with the real viewer, and
 * lets Publish insert it into the page.
 *
 * The REAL component is mounted. Its data seams are shadowed on the singletons,
 * the same technique GenericViewer.stories.ts uses:
 *  - getContext() returns forgeGlobal.forgeContext as soon as it is set, so a
 *    preset context skips the Forge bridge. `extension.location` feeds the
 *    "Page:" link base; `extension.config.customContentId` pre-selects a document
 *    exactly as an existing Embed macro does;
 *  - globals.apWrapper.searchCustomContentForge / getCustomContentByIdV2 return
 *    the fixture below.
 * Nothing here reaches Forge, Confluence or the backend.
 *
 * The component has no loading skeleton and no empty-state copy: while the
 * search is pending, and when it returns nothing, the list is simply blank and
 * the right pane keeps saying "Select a document to preview".
 */
type CustomContentItem = {
  id: string
  title: string
  container: { id: string; title: string }
  value: { diagramType: string; code?: string; mermaidCode?: string; graphXml?: string }
}

const SAMPLE_ITEMS: CustomContentItem[] = [
  {
    id: 'cc-001',
    title: 'User Authentication Flow',
    container: { id: 'page-1', title: 'Backend Architecture' },
    value: { diagramType: DiagramType.Sequence, code: 'Client->Server: login()\nServer-->Client: token' },
  },
  {
    id: 'cc-002',
    title: 'CI/CD Pipeline',
    container: { id: 'page-1', title: 'Backend Architecture' },
    value: { diagramType: DiagramType.Mermaid, mermaidCode: 'graph LR\n  A[Commit] --> B[Build]\n  B --> C[Deploy]' },
  },
  {
    id: 'cc-003',
    title: 'System Context Diagram',
    container: { id: 'page-2', title: 'Cloud Infrastructure' },
    value: { diagramType: DiagramType.Graph, graphXml: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>' },
  },
  {
    id: 'cc-004',
    title: 'Payment API Spec',
    container: { id: 'page-2', title: 'Cloud Infrastructure' },
    value: { diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0\ninfo:\n  title: Payment API\n  version: 1.0.0\npaths: {}' },
  },
  {
    id: 'cc-005',
    title: 'Order State Machine',
    container: { id: 'page-3', title: 'Order Service' },
    value: { diagramType: DiagramType.Mermaid, mermaidCode: 'stateDiagram-v2\n  [*] --> Placed\n  Placed --> Shipped' },
  },
]

function configureStory({ items, pickedId }: { items: CustomContentItem[]; pickedId?: string }) {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    siteUrl: 'https://example-tenant.atlassian.net',
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'DOCS' },
      // AtlasPage.getHref() returns this; DocumentList keeps everything up to and
      // including 'pages/' as the base of its "Page: …" links.
      location: 'https://example-tenant.atlassian.net/wiki/spaces/DOCS/pages/123456/Storybook',
      config: pickedId ? { customContentId: pickedId } : {},
    },
  } as any
  ;(globals.apWrapper as any).searchCustomContentForge = async () => items
  ;(globals.apWrapper as any).getCustomContentByIdV2 = async (id: string) =>
    items.find((item) => item.id === id) ?? null
}

const meta: Meta<typeof DocumentList> = {
  title: 'Shared/DocumentList',
  component: DocumentList,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The Embed macro editor (ForgeEmbedEditor.vue → DocumentList.vue): every diagram stored as ' +
          'Confluence custom content, grouped by page, with type and keyword filters on the left and ' +
          'a live preview of the picked diagram on the right; Publish inserts the picked diagram into ' +
          'the page. The real component is mounted and its Forge data calls are stubbed with the ' +
          'fixture in this file. There is no loading skeleton and no empty-state copy: with nothing ' +
          'to list the left pane is blank and the right pane says "Select a document to preview".',
      },
    },
  },
}

export default meta

type Story = StoryObj<typeof DocumentList>

/** Five diagrams across three pages. Nothing is picked yet, so the right pane shows its placeholder. */
export const Populated: Story = {
  name: 'Populated — nothing picked',
  decorators: [
    () => {
      configureStory({ items: SAMPLE_ITEMS })
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Page: Backend Architecture')).toBeVisible()
    await expect(canvas.getByText('Page: Cloud Infrastructure')).toBeVisible()
    await expect(canvas.getByText('Page: Order Service')).toBeVisible()
    await expect(canvas.getByText('User Authentication Flow')).toBeVisible()
    await expect(canvas.getByText('Order State Machine')).toBeVisible()
    await expect(canvas.getByText('Select a document to preview')).toBeVisible()
  },
}

/**
 * Opened from an existing Embed macro: extension.config.customContentId names the
 * embedded diagram, DocumentList pre-selects it and the real viewer renders it in
 * the right pane (a ZenUML sequence here, through DiagramPortal).
 */
export const Preselected: Story = {
  name: 'Preselected — real preview of the embedded diagram',
  decorators: [
    () => {
      configureStory({ items: SAMPLE_ITEMS, pickedId: 'cc-001' })
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Page: Backend Architecture')).toBeVisible()
    await waitFor(
      () => {
        if (!document.querySelector('.zenuml')) throw new Error('ZenUML preview not rendered yet')
      },
      { timeout: 15000 },
    )
    await expect(canvas.queryByText('Select a document to preview')).toBeNull()
  },
}

/** No custom content in the site: the list is blank (the component has no empty-state copy) and the right pane keeps its placeholder. */
export const Empty: Story = {
  name: 'Empty — no diagrams stored',
  decorators: [
    () => {
      configureStory({ items: [] })
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Select a document to preview')).toBeVisible()
    await expect(canvas.getByPlaceholderText('search in title and content')).toBeVisible()
    await expect(canvas.queryByText(/^Page: /)).toBeNull()
  },
}
