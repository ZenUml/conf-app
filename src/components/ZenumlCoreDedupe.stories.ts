import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { defineComponent, h, onMounted, ref } from 'vue'
import { expect, waitFor } from 'storybook/test'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { forceLinting } from '@codemirror/lint'
import Mermaid from './Mermaid.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'
import { baseExtensionsFactory, zenumlExtensions } from '@/components/Editor/extensions'

setup((app) => {
  app.use(store)
})

// The two @zenuml/core consumers that used to carry their own copy:
// @mermaid-js/mermaid-zenuml (a `zenuml` diagram inside a Mermaid macro) and
// the editor's ZenUML linter. Both now resolve to the app's @zenuml/core.
const MERMAID_ZENUML = `zenuml
  title Order service
  @Actor Client
  @VPC Gateway
  @Lambda Orders
  @RDS Database
  Client->Gateway.placeOrder(items) {
    Gateway->Orders.create(items) {
      Orders->Database: insert
      return orderId
    }
  }`

const meta: Meta = {
  title: 'Viewer/ZenumlCoreDedupe',
  // Storybook does not serve `vendor/mermaid/`; hand the loader the bundled copy
  // (same priming as MermaidSizing.stories.ts).
  loaders: [
    async () => {
      __resetMermaidLoaderForTests()
      const bundledMermaid = await import('mermaid')
      await loadMermaid({ importer: async () => bundledMermaid, retries: 0 })
      return {}
    },
  ],
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

export const MermaidZenumlWithCloudIcons: Story = {
  render: () => ({
    components: { Mermaid },
    setup() {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit('updateMermaidCode', MERMAID_ZENUML)
    },
    template: '<div style="width: 100%; height: 560px; padding: 24px; box-sizing: border-box;"><Mermaid /></div>',
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('svg')?.textContent).toContain('Database'), { timeout: 15000 })
    const svg = canvasElement.querySelector('svg')!
    for (const name of ['Client', 'Gateway', 'Orders', 'placeOrder', 'insert']) {
      await expect(svg.textContent).toContain(name)
    }
  },
}

const LintHarness = defineComponent({
  props: { code: { type: String, required: true } },
  setup(props) {
    const host = ref<HTMLElement | null>(null)
    onMounted(() => {
      const view = new EditorView({
        parent: host.value!,
        state: EditorState.create({ doc: props.code, extensions: [...baseExtensionsFactory(() => {}), ...zenumlExtensions] }),
      })
      forceLinting(view)
    })
    return () => h('div', { ref: host, 'data-testid': 'lint-host', style: 'height: 240px; margin: 24px; border: 1px solid #ccc;' })
  },
})

export const ZenumlEditorLintFlagsError: Story = {
  render: () => ({
    components: { LintHarness },
    template: '<LintHarness code="Client->Server.login(user {\n  return token\n}" />',
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.cm-lintRange-error')).not.toBeNull(), { timeout: 10000 })
  },
}

export const ZenumlEditorLintAcceptsValidCode: Story = {
  render: () => ({
    components: { LintHarness },
    template: '<LintHarness code="Client->Server.login(user) {\n  return token\n}" />',
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.cm-content')).not.toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await expect(canvasElement.querySelector('.cm-lintRange-error')).toBeNull()
  },
}
