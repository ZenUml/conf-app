import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { expect, waitFor } from 'storybook/test'
import Mermaid from './Mermaid.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'

type Story = StoryObj<typeof Mermaid>

// Mermaid.vue reads `this.$store`, which only exists once the Vuex plugin is
// installed on the Storybook app instance.
setup((app) => {
  app.use(store)
})

// Width of the Lite macro viewer iframe measured on Confluence production
// (2026-09-07). Any container narrower than the diagram's natural width
// triggers the letterbox; 562px is the real one.
const VIEWER_WIDTH = 562

// A flowchart whose natural width (~1700px) exceeds the viewer, and whose
// height is several times that. Synthetic on purpose — the production diagram
// that surfaced this belongs to a customer.
const WIDE_TALL_FLOWCHART = `
flowchart TB
  subgraph ROW1["Stage one — intake"]
    direction LR
    A1["Receive the request with a deliberately long descriptive label"] --> A2["Validate the incoming payload against the schema"] --> A3["Enqueue the unit of work for a background worker"] --> A4["Acknowledge the caller"]
  end
  subgraph ROW2["Stage two — evidence"]
    direction LR
    B1["Fetch candidate evidence from the primary store"] --> B2["Rank the candidates with the hybrid scorer"] --> B3["Apply the policy filter to the ranked list"] --> B4["Record the shortlist"]
  end
  subgraph ROW3["Stage three — plan"]
    direction LR
    C1["Aggregate the result of every branch"] --> C2["Translate the decision into a fixed plan"] --> C3["Re-read the store for a preflight check"] --> C4{"Is the plan still applicable?"}
  end
  subgraph ROW4["Stage four — apply"]
    direction LR
    D1["Write the primary record to the database"] --> D2["Synchronise the search index"] --> D3["Persist the decision to long-term memory"] --> D4["Report the combined status"]
  end
  A4 --> B1
  B4 --> C1
  C4 -->|applicable| D1
  C4 -->|superseded| E1["Stop without writing anything"]
  D4 --> DONE(["Complete"])
  E1 --> HALT(["Halted, nothing written"])
`

const INIT_USE_MAX_WIDTH_FALSE =
  '%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "wrappingWidth": 800}}}%%'

const INIT_USE_MAX_WIDTH_TRUE =
  '%%{init: {"theme": "base", "flowchart": {"useMaxWidth": true, "wrappingWidth": 800}}}%%'

function loadDiagram(mermaidCode: string) {
  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMermaidCode', mermaidCode)
}

/**
 * Measure the white band above the drawing, the way a reader perceives it:
 * the distance from the top of the <svg> box to the top of the rendered
 * content.
 */
async function measureTopGap(): Promise<{ gap: number; svgHeight: number; contentHeight: number }> {
  const svg = await waitFor(() => {
    const el = document.querySelector<SVGSVGElement>('svg[id^="mermaid-"]')
    if (!el) throw new Error('mermaid svg not rendered yet')
    return el
  })
  const content = svg.querySelector<SVGGElement>('g.root') ?? svg.querySelector('g')!
  const svgBox = svg.getBoundingClientRect()
  const contentBox = content.getBoundingClientRect()
  return {
    gap: Math.round(contentBox.top - svgBox.top),
    svgHeight: Math.round(svgBox.height),
    contentHeight: Math.round(contentBox.height),
  }
}

const meta: Meta<typeof Mermaid> = {
  title: 'Viewer/MermaidSizing',
  component: Mermaid,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Mermaid.vue wraps the rendered SVG in a `flex justify-center` container. Flexbox shrinks a ' +
          "flex item's width but never its height attribute, so a diagram rendered with " +
          '`useMaxWidth: false` — which carries hard pixel width AND height attributes — gets scaled ' +
          'down to the container width and then letterboxed dead centre in the leftover vertical ' +
          'space. These stories put the two shapes side by side at the real 562px viewer width.',
      },
    },
  },
  decorators: [
    () => ({
      template:
        `<div style="width:${VIEWER_WIDTH}px;margin:0 auto;outline:2px solid #d92d20">` +
        '<story />' +
        '</div>',
    }),
  ],
}

export default meta

/**
 * `useMaxWidth: false` makes mermaid emit hard `width` and `height` attributes.
 * Unpatched, the flex container narrows the width to 562px while the height
 * attribute survives, and the default `preserveAspectRatio="xMidYMid meet"`
 * centres the shrunken drawing — leaving a tall white band above and below it.
 * Measured before the fix: a 2135px-tall box holding a 1586px drawing, 274px of
 * white on top. On Lite production the same defect produced a 1630px band.
 *
 * This story asserts the SVG box is no taller than what it draws.
 */
export const UseMaxWidthFalse: Story = {
  decorators: [
    () => {
      loadDiagram(`${INIT_USE_MAX_WIDTH_FALSE}${WIDE_TALL_FLOWCHART}`)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const { gap, svgHeight, contentHeight } = await measureTopGap()
    await expect(svgHeight).toBeLessThan(contentHeight * 1.2)
    await expect(gap).toBeLessThan(40)
  },
}

/**
 * Mermaid's default. `width="100%"` and no height attribute let the browser
 * derive the height from the viewBox, so this shape never letterboxed. It is
 * here to prove the fix does not regress it.
 */
export const UseMaxWidthTrue: Story = {
  decorators: [
    () => {
      loadDiagram(`${INIT_USE_MAX_WIDTH_TRUE}${WIDE_TALL_FLOWCHART}`)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const { gap, svgHeight, contentHeight } = await measureTopGap()
    await expect(svgHeight).toBeLessThan(contentHeight * 1.2)
    await expect(gap).toBeLessThan(40)
  },
}
