import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { expect } from 'storybook/test'
import Mermaid from './Mermaid.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'

type Story = StoryObj<typeof Mermaid>

setup((app) => {
  app.use(store)
})

// A state diagram with labelled transitions. In a document with no layout,
// mermaid 11.17.2 cannot place its edge labels and throws `Could not find a
// suitable point for the given distance` rather than `svg element not in
// render tree` (Mermaid.vue isTransientRenderError). Synthetic on purpose:
// the production diagrams that hit it belong to customers.
const STATE_DIAGRAM = `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Draft : reject
  Review --> Approved : approve
  Approved --> [*]`

// How long the body stays hidden: long enough for the first render to run
// against no layout, as in a collapsed Confluence expand macro.
const HIDDEN_MS = 2000

const meta: Meta<typeof Mermaid> = {
  title: 'Viewer/MermaidHiddenLayout',
  component: Mermaid,
  // Same priming as MermaidSizing.stories.ts: Storybook does not serve
  // `vendor/mermaid/`, so hand the loader the bundled copy.
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
          'A Mermaid macro inside a collapsed expand renders in a Forge iframe whose document has ' +
          'no layout box. This story hides the preview `<body>` (mermaid lays out its temporary ' +
          'node there, so hiding a container would not reproduce it) while the first render runs, ' +
          'then reveals it. The viewer must wait for layout and retry, so the diagram appears ' +
          'instead of staying blank.',
      },
    },
  },
}

export default meta

export const StateDiagramRevealedAfterHidden: Story = {
  decorators: [
    () => {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit('updateMermaidCode', STATE_DIAGRAM)
      document.body.style.display = 'none'
      setTimeout(() => {
        document.body.style.display = ''
      }, HIDDEN_MS)
      return { template: '<div style="width:562px;margin:0 auto"><story /></div>' }
    },
  ],
  play: async () => {
    let svg: SVGSVGElement | null = null
    for (let attempt = 0; attempt < 60 && !svg; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      svg = document.querySelector<SVGSVGElement>('svg[id^="mermaid-"]')
    }
    await expect(document.body.style.display).toBe('')
    await expect(svg).not.toBeNull()
    await expect(svg!.querySelectorAll('g.edgeLabel').length).toBeGreaterThan(0)
  },
}
