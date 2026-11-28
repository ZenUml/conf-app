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

// Synthetic on purpose: the production flowcharts that hit this belong to
// customers. Non-Latin1 labels, as in the failing diagrams.
const FLOWCHART = `flowchart TD
  A[Bắt đầu] --> B{Kiểm tra dữ liệu}
  B -->|Có| C[Đăng nhập]
  B -->|Không| A`

// Mermaid's insertEdge serialises each edge's points for the debug-only
// `data-points` attribute. When a polygon shape finds no intersection, its
// helper returns the whole node, so the label lands in that JSON. The layout
// that causes this was not reproducible synthetically, so the story injects
// the same leak: the first point of every edge carries a non-Latin1 label.
// Unpatched mermaid 11.17.2 then throws "Failed to execute 'btoa' on
// 'Window' ... outside of the Latin1 range" and the macro shows no diagram.
const originalStringify = JSON.stringify
function leakLabelIntoEdgePoints() {
  JSON.stringify = function (value: unknown, ...rest: unknown[]) {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
    ) {
      value = [{ ...value[0], label: 'Kiểm tra dữ liệu' }, ...value.slice(1)]
    }
    return (originalStringify as (...args: unknown[]) => string).call(this, value, ...rest)
  } as typeof JSON.stringify
}

const meta: Meta<typeof Mermaid> = {
  title: 'Viewer/MermaidNonLatinEdgePoints',
  component: Mermaid,
  // Same priming as MermaidHiddenLayout.stories.ts: Storybook does not serve
  // `vendor/mermaid/`, so hand the loader the bundled copy (patched by
  // patches/mermaid@11.17.2.patch, like the vendored production build).
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
          'A flowchart whose edge points carry non-Latin1 text must still render. Mermaid ' +
          'encodes those points for a debug attribute; with raw `btoa` the whole diagram ' +
          'failed (viewer_load_failed). The patched encoder handles any Unicode text.',
      },
    },
  },
}

export default meta

export const FlowchartWithNonLatinEdgePoints: Story = {
  decorators: [
    () => {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit('updateMermaidCode', FLOWCHART)
      leakLabelIntoEdgePoints()
      return { template: '<div style="width:562px;margin:0 auto"><story /></div>' }
    },
  ],
  play: async () => {
    try {
      let svg: SVGSVGElement | null = null
      for (let attempt = 0; attempt < 60 && !svg; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        svg = document.querySelector<SVGSVGElement>('svg[id^="mermaid-"]')
      }
      await expect(svg).not.toBeNull()
      // Every edge kept its debug attribute, now holding UTF-8 bytes.
      await expect(svg!.querySelectorAll('[data-points]').length).toBe(3)
      await expect(svg!.textContent).toContain('Kiểm tra dữ liệu')
    } finally {
      JSON.stringify = originalStringify
    }
  },
}
