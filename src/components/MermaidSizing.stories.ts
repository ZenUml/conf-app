import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { expect } from 'storybook/test'
import Mermaid from './Mermaid.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'
import { normalizeSvgSizing } from '@/utils/mermaid/normalizeSvgSizing'
import { defineComponent, h, onMounted, ref } from 'vue'

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
  // Three states pass through this element, and only the last one is the shape
  // a reader sees. Mermaid mounts the svg; svg-pan-zoom then re-wraps its
  // contents in `g.svg-pan-zoom_viewport` and applies a fit transform. Waiting
  // only for the element measures the first state (a 150px box around a
  // zero-height drawing); waiting only for a non-zero height measures the
  // second, which is smaller than the settled one and would make this story
  // report a band it cannot actually see. So: measure repeatedly and take the
  // geometry only once two readings a quarter-second apart agree.
  const read = () => {
    const el = document.querySelector<SVGSVGElement>('svg[id^="mermaid-"]')
    if (!el) return null
    const root = el.querySelector<SVGGElement>('g.root') ?? el.querySelector('g')
    if (!root) return null
    const svgBox = el.getBoundingClientRect()
    const contentBox = root.getBoundingClientRect()
    if (contentBox.height === 0) return null
    return {
      gap: Math.round(contentBox.top - svgBox.top),
      svgHeight: Math.round(svgBox.height),
      contentHeight: Math.round(contentBox.height),
    }
  }

  const settle = async () => {
    let previous: ReturnType<typeof read> = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const current = read()
      if (
        current &&
        previous &&
        current.gap === previous.gap &&
        current.svgHeight === previous.svgHeight &&
        current.contentHeight === previous.contentHeight
      ) {
        return current
      }
      previous = current
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('mermaid geometry never settled')
  }

  return settle()
}

const meta: Meta<typeof Mermaid> = {
  title: 'Viewer/MermaidSizing',
  component: Mermaid,
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

/**
 * Reproduces Mermaid.vue's wrapper — the same `flex justify-center` container —
 * but lets the caller decide whether the fix runs. `patched: false` shows what
 * every reader saw before this branch.
 */
const MermaidPane = defineComponent({
  name: 'MermaidPane',
  props: {
    code: { type: String, required: true },
    patched: { type: Boolean, required: true },
  },
  setup(props) {
    const svg = ref('')
    const measurement = ref('measuring...')
    onMounted(async () => {
      const mermaid = await loadMermaid()
      const rendered = await mermaid.render(`mermaid-${crypto.randomUUID()}`, props.code)
      svg.value = props.patched ? normalizeSvgSizing(rendered.svg) : rendered.svg
      // Two frames plus a tick: the pane must be laid out before the SVG box
      // means anything, and mermaid's fonts settle on the frame after that.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise((resolve) => setTimeout(resolve, 200))
      const el = document.querySelectorAll<SVGSVGElement>('svg[id^="mermaid-"]')
      const mine = [...el].find((candidate) => candidate.closest('[data-pane]')?.getAttribute('data-pane') === (props.patched ? 'after' : 'before'))
      if (!mine) return
      const content = mine.querySelector('g.root') ?? mine.querySelector('g')!
      const svgBox = mine.getBoundingClientRect()
      const contentBox = content.getBoundingClientRect()
      measurement.value =
        `svg box ${Math.round(svgBox.height)}px, drawing ${Math.round(contentBox.height)}px, ` +
        `white on top ${Math.round(contentBox.top - svgBox.top)}px`
    })
    return () =>
      h('div', { style: `width:${VIEWER_WIDTH}px;flex:0 0 ${VIEWER_WIDTH}px` }, [
        h(
          'div',
          { style: 'font:600 13px system-ui;padding:6px 0' },
          props.patched ? 'AFTER (this branch)' : 'BEFORE (shipped today)',
        ),
        h('div', { style: 'font:12px/1.5 system-ui;color:#475467;padding-bottom:6px' }, measurement.value),
        h('div', {
          'data-pane': props.patched ? 'after' : 'before',
          class: 'flex justify-center',
          style: 'outline:2px solid #d92d20',
          innerHTML: svg.value,
        }),
      ])
  },
})

/**
 * Both panes render the same `useMaxWidth: false` diagram in the same 562px
 * container. The left one skips normalizeSvgSizing, so its red box extends far
 * above and below the drawing; the right one does not.
 */
export const BeforeAndAfter: Story = {
  render: () => ({
    components: { MermaidPane },
    setup: () => ({ code: `${INIT_USE_MAX_WIDTH_FALSE}${WIDE_TALL_FLOWCHART}` }),
    template:
      '<div style="display:flex;gap:32px;align-items:flex-start;padding:16px">' +
      '<MermaidPane :code="code" :patched="false" />' +
      '<MermaidPane :code="code" :patched="true" />' +
      '</div>',
  }),
}
