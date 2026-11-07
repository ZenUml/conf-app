import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import type { App } from 'vue'
import { expect, waitFor, within } from 'storybook/test'
import Workspace from './Workspace.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { TIP_TYPED_CHARS } from '@/composables/agentLink/useEditorMcpPromo'

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

function prepare({ id }: { id: string }) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('zenuml.mcpPromo') || key.startsWith('zenuml.connectMcpShown')) localStorage.removeItem(key)
  }
  sessionStorage.removeItem('zenuml.mcpPromo.session')
  localStorage.setItem('mockAgentLinkEnabled', 'true')
  store.commit('updateDiagramType', DiagramType.Sequence)
  store.commit('updateCode2', STARTER)
  store.commit('updateTitle', 'Checkout sequence')
  ;(store.state as any).diagram.id = id
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
