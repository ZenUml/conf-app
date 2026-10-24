import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { expect, waitFor } from 'storybook/test'
import Editor from './Editor.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'

type Story = StoryObj<typeof Editor>

setup((app) => {
  app.use(store)
})

const body = '\nflowchart TB\n  A["one"] --> B["two"]'

/** The customer's shape: the value after `nodeSpacing:` is gone. */
const IGNORED_INIT =
  '%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "nodeSpacing": , "rankSpacing": 70}}}%%' + body

/** Mermaid's documented single-quoted form — valid, must stay unmarked. */
const ACCEPTED_INIT = "%%{init: {'theme': 'forest'}}%%" + body

function loadDiagram(mermaidCode: string) {
  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMermaidCode', mermaidCode)
}

const meta: Meta<typeof Editor> = {
  title: 'Editor/Diagram/MermaidInitWarning',
  component: Editor,
  // Mermaid is fetched at runtime from `vendor/mermaid/` (loadMermaid.ts), which
  // vite.config.mjs copies into `dist/` for the app build. Storybook serves
  // `public/`, which has no such directory, so the unprimed default import 404s.
  // Hand the loader the bundled copy instead — the same priming every other
  // story that renders real Mermaid does (see GenericViewer.stories.ts).
  loaders: [
    async () => {
      __resetMermaidLoaderForTests()
      const bundledMermaid = await import('mermaid')
      await loadMermaid({ importer: async () => bundledMermaid, retries: 0 })
      return {}
    },
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A malformed `%%{init: …}%%` is the one mermaid failure nothing reports: `mermaid.parse` ' +
          'succeeds, the diagram renders with default settings, and `macro_viewed` records a ' +
          'success. These stories show the CodeMirror lint warning that now covers it, and prove ' +
          "mermaid's valid single-quoted form is left alone.",
      },
    },
  },
  decorators: [
    () => ({ template: '<div style="height:420px"><story /></div>' }),
  ],
}

export default meta

export const DirectiveIgnored: Story = {
  decorators: [
    () => {
      loadDiagram(IGNORED_INIT)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    // CodeMirror renders lint marks asynchronously, after its lint delay.
    await waitFor(
      () => {
        const marks = document.querySelectorAll('.cm-lintRange-warning')
        if (!marks.length) throw new Error('no warning mark yet')
        return marks
      },
      { timeout: 5000 },
    )
    await expect(document.querySelectorAll('.cm-lintRange-error')).toHaveLength(0)
  },
}

export const DirectiveAccepted: Story = {
  decorators: [
    () => {
      loadDiagram(ACCEPTED_INIT)
      return { template: '<story />' }
    },
  ],
}
