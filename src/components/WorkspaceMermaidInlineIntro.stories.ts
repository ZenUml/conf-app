import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { onUnmounted, provide, type App } from 'vue'
import Workspace from './Workspace.vue'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import store from '@/model/store2'
import { createIntroSeenStore } from '@/features/mermaidInlineIntro/seen'
import { inlineIntroSeenStore } from '@/features/mermaidInlineIntro/useMermaidInlineIntro'

setup((app: App) => { app.use(store) })

const sequence = 'sequenceDiagram\n    participant B as Buyer\n    participant S as Store\n    B->>S: Track shipment\n    S-->>B: Show status'
const flowchart = 'flowchart LR\n    A[Draft] --> B[Review]\n    B --> C[Publish]'
const unsupported = 'erDiagram\n    CUSTOMER ||--o{ ORDER : places'

const seen = createIntroSeenStore(async (url, method) => {
  const key = 'storybook:confluence:' + url
  const delay = new URLSearchParams(location.search).get('introDelay')
  if (method === 'GET' && delay) await new Promise((resolve) => setTimeout(resolve, Number(delay)))
  if (method === 'POST') {
    localStorage.setItem(key, 'seen')
    return new Response(null, { status: 201 })
  }
  return new Response(null, { status: localStorage.getItem(key) ? 200 : 404 })
})

function fixture(code: string, title: string) {
  return {
    setup() {
      const previousForge = { ...forgeGlobal }
      onUnmounted(() => Object.assign(forgeGlobal, previousForge))
      const accountId = new URLSearchParams(location.search).get('introAccount') || 'example-author'
      forgeGlobal.isForge = true
      forgeGlobal.forgeContext = {
        accountId,
        cloudId: 'example-cloud',
        environmentType: 'DEVELOPMENT',
        siteUrl: 'https://example.atlassian.net',
        extension: { modal: { macroMode: 'editor' } },
      }
      forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
      const diagram = store.state.diagram
      diagram.id = 'mermaid-inline-intro-story'
      diagram.isNew = false
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit('updateMermaidCode', code)
      store.commit('updateTitle', title)
      provide(inlineIntroSeenStore, seen)
    },
    template: '<story />',
  }
}

const meta = {
  title: 'Editor/Diagram/WorkspaceMermaidInlineIntro',
  component: Workspace,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Workspace>
export default meta

type Story = StoryObj<typeof meta>

export const Sequence: Story = {
  decorators: [() => fixture(sequence, 'Order tracking')],
}

export const Flowchart: Story = {
  decorators: [() => fixture(flowchart, 'Publishing workflow')],
}

export const Unsupported: Story = {
  decorators: [() => fixture(unsupported, 'Customer orders')],
}
