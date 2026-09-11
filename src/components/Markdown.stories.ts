import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import Markdown from './Markdown.vue'
import Mermaid from './Mermaid.vue'
import Header from './Header/Header.vue'
import Editor from './Editor/Editor.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'

setup(app => { app.use(store) })

const document = `# Service documentation

Generated documentation with **Markdown** and Mermaid diagrams.

## Request flow

\`\`\`mermaid
flowchart LR
  Client --> API --> Database
\`\`\`

## Response sequence

\`\`\`mermaid
sequenceDiagram
  Client->>API: GET /items
  API-->>Client: Items
\`\`\`

| Component | Responsibility |
| --- | --- |
| API | Handle requests |
| Database | Store items |

- [x] Render diagrams
- [ ] Review documentation

\`\`\`typescript
const ready = true;
\`\`\`
`

function configure(source: string | undefined, type = DiagramType.Markdown) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.invalid'
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.isDisplayMode = () => false
  store.state.diagram.markdownCode = source
  store.commit('updateDiagramType', type)
  store.commit('updateMermaidCode', 'flowchart LR\n  Client --> API')
  store.commit('updateCode2', 'Client->API: request')
  store.commit('updateTitle', 'Service documentation')
  store.state.diagram.id = 'storybook-markdown'
  store.state.diagram.isNew = false
}

const meta: Meta<typeof Markdown> = {
  title: 'Editor/Diagram/Markdown',
  component: Markdown,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof Markdown>

export const Document: Story = {
  decorators: [() => { configure(document); return { template: '<story />' } }],
}

export const BrokenDiagram: Story = {
  decorators: [() => {
    configure(document + '\n## Invalid diagram\n\n```mermaid\nthis is not a diagram\n```\n\nText after the invalid diagram stays visible.\n')
    return { template: '<story />' }
  }],
}

export const ZenUmlExtension: Story = {
  decorators: [() => {
    configure(document + '\n## ZenUML sequence\n\n```mermaid\nzenuml\n  Client->API: Request\n  API->Database: Query\n```\n\nText after the ZenUML diagram.\n')
    return { template: '<story />' }
  }],
}

export const Empty: Story = {
  decorators: [() => { configure(''); return { template: '<story />' } }],
}

export const EditorTabs: Story = {
  render: () => ({
    components: { Header, Editor, Markdown, Mermaid },
    setup() {
      configure(undefined, DiagramType.Mermaid)
      return { type: computed(() => store.state.diagram.diagramType) }
    },
    template: `<div style="height:100vh;display:flex;flex-direction:column;background:white">
      <Header />
      <div style="display:grid;grid-template-columns:1fr 1fr;flex:1;min-height:0">
        <Editor />
        <div style="overflow:auto;border-left:1px solid #dfe1e6">
          <Markdown v-if="type === 'markdown'" />
          <Mermaid v-else-if="type === 'mermaid'" />
        </div>
      </div>
    </div>`,
  }),
}
