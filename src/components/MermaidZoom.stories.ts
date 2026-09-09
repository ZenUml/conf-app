import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { expect, waitFor, userEvent } from 'storybook/test'
import Mermaid from './Mermaid.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'

type Story = StoryObj<typeof Mermaid>

setup((app) => {
  app.use(store)
})

// The Lite macro viewer iframe measured on Confluence production (2026-09-07),
// the same width MermaidSizing.stories.ts uses. The point of these stories is
// that the diagram below does NOT fit in it: jsdom has no layout, so the unit
// tests can only ever measure a fit scale of 1, and the shrunk-to-fit case —
// the one the whole feature exists for — is only observable in a browser.
const VIEWER_WIDTH = 562

const WIDE_FLOWCHART = `
flowchart LR
  A["Receive the request with a deliberately long descriptive label"] --> B["Validate the incoming payload against the schema"]
  B --> C["Enqueue the unit of work for a background worker"]
  C --> D["Rank the candidates with the hybrid scorer"]
  D --> E["Apply the policy filter to the ranked list"]
  E --> F{"Is the plan still applicable?"}
  F -->|applicable| G["Write the primary record to the database"]
  F -->|superseded| H["Stop without writing anything"]
`

function loadDiagram(mermaidCode: string) {
  store.commit('updateDiagramType', DiagramType.Mermaid)
  store.commit('updateMermaidCode', mermaidCode)
}

/**
 * The rendered diagram, scoped to the component's own canvas. Deliberately NOT
 * `svg[id^="mermaid-"]`: mermaid measures each render in a throwaway node it
 * appends to the body, and a document-wide query races it.
 */
const rendered = () =>
  waitFor(() => {
    const svg = document.querySelector<SVGSVGElement>('.mermaid-zoom-canvas svg')
    if (!svg || svg.getBoundingClientRect().width === 0) throw new Error('not rendered yet')
    if (!parseFloat(svg.style.maxWidth)) throw new Error('not sized yet')
    return svg
  })

/** What the reader actually sees, in CSS pixels, transform included. */
const drawnWidth = (svg: SVGSVGElement) => Math.round(svg.getBoundingClientRect().width)

/** The width mermaid authored the diagram at, before any container shrank it. */
const naturalWidth = (svg: SVGSVGElement) => Math.round(parseFloat(svg.style.maxWidth))

const control = (testId: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!

/**
 * The control pill is `pointer-events: none` until the diagram is hovered —
 * invisible chrome must not eat clicks meant for the diagram — so a click has
 * to be preceded by the hover a reader would make.
 */
async function press(testId: string) {
  await userEvent.hover(document.querySelector<HTMLElement>('.mermaid-zoom')!)
  await userEvent.click(control(testId))
}

const meta: Meta<typeof Mermaid> = {
  title: 'Viewer/MermaidZoom',
  component: Mermaid,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The viewer scales a wide mermaid diagram DOWN into its column and, until this feature, ' +
          'offered no way to get the size back (ZEN-1207). These stories put a diagram wider than ' +
          'the real 562px viewer in that column and drive the zoom control against real geometry.',
      },
    },
  },
  decorators: [
    () => {
      loadDiagram(WIDE_FLOWCHART)
      return {
        template:
          `<div style="width:${VIEWER_WIDTH}px;margin:24px auto;outline:2px solid #d92d20">` +
          '<story />' +
          '</div>',
      }
    },
  ],
}

export default meta

/**
 * The premise. The diagram is drawn at the column width, well below the width
 * mermaid authored it at — and the wrapper carries no transform at all, so an
 * untouched diagram is the DOM that shipped before this feature.
 */
export const FitByDefault: Story = {
  play: async () => {
    const svg = await rendered()
    await expect(drawnWidth(svg)).toBeLessThan(naturalWidth(svg))
    await expect(drawnWidth(svg)).toBeLessThanOrEqual(VIEWER_WIDTH)

    const canvas = document.querySelector<HTMLElement>('.mermaid-zoom-canvas')!
    await expect(canvas.getAttribute('style')).toBe(null)
    await expect(control('mermaid-zoom-reset').textContent!.trim()).not.toBe('100%')
    await expect(control('mermaid-zoom-reset').disabled).toBe(true)
  },
}

/**
 * Three clicks of + magnify the drawing by 1.25^3, and the box it lives in does
 * NOT grow: a transform never affects layout, so the macro keeps the height the
 * Forge iframe already sized itself to instead of shoving the page around.
 */
export const ZoomedIn: Story = {
  play: async () => {
    const svg = await rendered()
    const fitWidth = drawnWidth(svg)
    const boxHeight = Math.round(
      document.querySelector<HTMLElement>('.mermaid-zoom-viewport')!.getBoundingClientRect().height,
    )

    for (let i = 0; i < 3; i++) await press('mermaid-zoom-in')

    await waitFor(async () => {
      await expect(drawnWidth(svg) / fitWidth).toBeCloseTo(1.25 ** 3, 1)
    })
    const after = document.querySelector<HTMLElement>('.mermaid-zoom-viewport')!
    await expect(Math.round(after.getBoundingClientRect().height)).toBe(boxHeight)
    await expect(after.classList.contains('mermaid-zoom-viewport--zoomed')).toBe(true)
    // Magnified past the column, so there is now something to pan.
    await expect(after.classList.contains('mermaid-zoom-viewport--grabbable')).toBe(true)
  },
}

/** Reset puts the diagram back at the fit level, transform attribute and all. */
export const ResetsToFit: Story = {
  play: async () => {
    const svg = await rendered()
    const fitWidth = drawnWidth(svg)

    await press('mermaid-zoom-in')
    await waitFor(async () => {
      await expect(drawnWidth(svg)).toBeGreaterThan(fitWidth)
    })

    await press('mermaid-zoom-reset')
    await waitFor(async () => {
      await expect(drawnWidth(svg)).toBe(fitWidth)
    })
    await expect(document.querySelector('.mermaid-zoom-canvas')!.getAttribute('style')).toBe(null)
  },
}
