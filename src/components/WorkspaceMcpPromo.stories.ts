import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { expect, waitFor, within } from 'storybook/test'
import Workspace from './Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { TIP_TYPED_CHARS } from '@/composables/agentLink/useEditorMcpPromo'
import { installRestoreDraftBanner } from '@/utils/restoreDraftBanner'
import EventBus from '@/EventBus'

// Workspace.vue reads the store through mapState and useStore(), so the Vuex
// plugin goes on Storybook's root app (see Header.stories.ts).
setup((app: App) => {
  app.use(store)
})

const STARTER = `// Checkout sequence
Client->OrderService.placeOrder(items) {
  Inventory.reserve(items) {
    return reserved
  }
  Payment.charge(card, total) {
    return receipt
  }
  return orderId
}`

const PREFERRED_TYPE_KEY = 'zenuml-preferred-diagram-type'
const GALLERY_MARKER_PREFIX = 'zenuml.starterGalleryAutoOpened.'

function prepare({ id, isNew = false, code = STARTER, preferredType, galleryAlreadyOpened = true }: {
  id: string
  isNew?: boolean
  code?: string
  preferredType?: DiagramType
  galleryAlreadyOpened?: boolean
}) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('zenuml.mcpPromo') || key.startsWith('zenuml.connectMcpShown') || key.startsWith(GALLERY_MARKER_PREFIX)) localStorage.removeItem(key)
  }
  sessionStorage.removeItem('zenuml.mcpPromo.session')
  localStorage.removeItem(PREFERRED_TYPE_KEY)
  if (preferredType) localStorage.setItem(PREFERRED_TYPE_KEY, preferredType)
  if (galleryAlreadyOpened) {
    for (const type of [DiagramType.Sequence, DiagramType.Mermaid]) localStorage.setItem(`${GALLERY_MARKER_PREFIX}unknown-cloud.${type}`, '1')
  }
  store.commit('updateDiagramType', DiagramType.Sequence)
  store.commit('updateCode2', code)
  store.commit('updateMermaidCode', 'sequenceDiagram\n  A->>B: Hello')
  store.commit('updateTitle', 'Checkout sequence')
  ;(store.state as any).diagram.id = id
  ;(store.state as any).diagram.isNew = isNew
}

const meta: Meta<typeof Workspace> = {
  title: 'Editor/Diagram/WorkspaceMcpPromo',
  component: Workspace,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'MCP promo in the macro editor (useEditorMcpPromo): a card over the preview while a new diagram is untouched, and a tip docked under the code after sustained manual typing.',
      },
    },
  },
}
export default meta

type Story = StoryObj<typeof Workspace>

/** A new diagram still showing its starter code: the "Start from your code" card. */
export const NewDiagramCard: Story = {
  decorators: [() => {
    prepare({ id: '' })
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByTestId('mcp-promo-card')).toHaveTextContent('Start from your code')
  },
}

/** A saved diagram after the author has typed a lot by hand: the code-pane tip. */
export const TypingTip: Story = {
  decorators: [() => {
    prepare({ id: '12345' })
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    const canvas = within(document.body)
    for (let typed = 0; typed < TIP_TYPED_CHARS; typed += 40) {
      store.commit('updateCode2', `${(store.state as any).diagram.code}\n// ${'x'.repeat(36)}`)
      await new Promise(r => setTimeout(r, 0))
    }
    await waitFor(() => expect(canvas.getByTestId('mcp-promo-tip')).toBeInTheDocument())
  },
}

/** Saved tab applied after setup: the card still shows, on Mermaid and back on Sequence. */
export const NewDiagramCardOnSavedTab: Story = {
  decorators: [() => {
    prepare({ id: '', isNew: true, preferredType: DiagramType.Mermaid })
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    const canvas = within(document.body)
    await waitFor(() => expect((store.state as any).diagram.diagramType).toBe(DiagramType.Mermaid))
    await expect(await canvas.findByTestId('mcp-promo-card')).toHaveTextContent('Start from your code')
  },
}

/**
 * Starter gallery auto-opened over a blank diagram: no card, and nothing counted
 * as shown until the card is really on screen.
 */
export const GalleryCoversCard: Story = {
  decorators: [() => {
    prepare({ id: '', isNew: true, code: '', galleryAlreadyOpened: false })
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    const canvas = within(document.body)
    const counted = () => Object.keys(localStorage).some(key => key.startsWith('zenuml.connectMcpShown'))
    await canvas.findByTestId('template-gallery')
    await new Promise(r => setTimeout(r, 300))
    await expect(canvas.queryByTestId('mcp-promo-card')).toBeNull()
    await expect(counted()).toBe(false)

    canvas.getByTestId('template-gallery-close').click()
    await canvas.findByTestId('mcp-promo-card')
    await expect(counted()).toBe(true)
  },
}

/** The draft banner sits on the tip's corner: the tip waits until it is gone. */
export const DraftBannerHoldsTip: Story = {
  decorators: [() => {
    prepare({ id: '12345' })
    installRestoreDraftBanner()
    return { template: '<div style="height: 760px;"><story /></div>' }
  }],
  play: async () => {
    const canvas = within(document.body)
    await new Promise(r => setTimeout(r, 300))
    EventBus.$emit('draft-available', { scope: 'edit:12345', draft: { code: 'x', title: 't', savedAt: Date.now() - 3600_000 } })
    for (let typed = 0; typed < TIP_TYPED_CHARS; typed += 40) {
      store.commit('updateCode2', `${(store.state as any).diagram.code}\n// ${'x'.repeat(36)}`)
      await new Promise(r => setTimeout(r, 0))
    }
    await new Promise(r => setTimeout(r, 300))
    await expect(canvas.queryByTestId('mcp-promo-tip')).toBeNull()

    canvas.getByRole('button', { name: 'Keep draft for later' }).click()
    await waitFor(() => expect(canvas.getByTestId('mcp-promo-tip')).toBeInTheDocument())
  },
}
