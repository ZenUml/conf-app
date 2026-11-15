<template>
  <!-- Sibling of .screen-capture-content, never inside it: exports (PNG, PDF,
       Word) and the stored PNG are cut from the capture node and must not
       carry the notice. Design: Figma 383:377 (1374x430 area, 96px / 30px). -->
  <svg
    ref="root"
    class="license-watermark"
    :style="diagramBox"
    data-testid="license-watermark"
    viewBox="0 0 1374 430"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
  >
    <g transform="rotate(-17.4 687 215)" fill="rgba(222, 53, 11, 0.16)" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
      <!-- Stacked layout: every line below the headline is sized to the headline's width. -->
      <template v-if="stacked">
        <text ref="headlineEl" x="687" :y="layout.headlineY" :font-size="STACKED_HEADLINE_SIZE" font-weight="700" letter-spacing="2">{{ headline }}</text>
        <text
          v-for="(line, index) in lines"
          :key="index"
          ref="lineEls"
          x="687"
          :y="layout.lineYs[index]"
          :font-size="lineSizes[index]"
          font-weight="600"
        >{{ line }}</text>
      </template>
      <template v-else>
        <text x="687" y="205" font-size="96" font-weight="700" letter-spacing="2">{{ headline }}</text>
        <text x="687" y="262" font-size="30" font-weight="500">{{ detail }}</text>
      </template>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Defaults are the Full "No active license" text. Lite passes `lines`, which
// switches to the stacked layout and ignores `detail`.
const props = withDefaults(defineProps<{ headline?: string; detail?: string; lines?: string[] }>(), {
  headline: 'NO ACTIVE LICENSE',
  detail: 'Payment required · Ask your Confluence admin to subscribe to Full',
  lines: undefined,
})

// Smaller than the 96px two-line headline: three lines of the headline's width,
// rotated, must stay inside the 430-unit height.
const STACKED_HEADLINE_SIZE = 74
const MIN_LINE_SIZE = 24
const MAX_LINE_SIZE = 64
const LINE_GAP = 20
const CAP_HEIGHT = 0.72

const stacked = computed(() => Array.isArray(props.lines) && props.lines.length > 0)
const lines = computed(() => props.lines ?? [])

// First guess from character counts; replaced by measured sizes once mounted.
const estimate = (line: string) => {
  const headlineWidth = props.headline.length * (STACKED_HEADLINE_SIZE * 0.66 + 2)
  return clamp(headlineWidth / (Math.max(line.length, 1) * 0.52))
}
const clamp = (size: number) => Math.min(MAX_LINE_SIZE, Math.max(MIN_LINE_SIZE, Math.round(size * 10) / 10))

const lineSizes = ref<number[]>(lines.value.map(estimate))
const headlineEl = ref<SVGTextElement | null>(null)
const lineEls = ref<SVGTextElement[]>([])

const layout = computed(() => {
  const headlineHeight = STACKED_HEADLINE_SIZE * CAP_HEIGHT
  const total = headlineHeight + lineSizes.value.reduce((sum, size) => sum + LINE_GAP + size * CAP_HEIGHT, 0)
  let y = 215 - total / 2 + headlineHeight
  const headlineY = y
  const lineYs = lineSizes.value.map((size) => (y += LINE_GAP + size * CAP_HEIGHT))
  return { headlineY, lineYs }
})

// Text width scales with font size, so one measurement gives the size that
// matches the headline. Environments without SVG text metrics keep the estimate.
async function fit() {
  if (!stacked.value) return
  lineSizes.value = lines.value.map(estimate)
  await nextTick()
  const target = headlineEl.value?.getComputedTextLength?.()
  if (!target) return
  lineSizes.value = lineSizes.value.map((size, index) => {
    const width = lineEls.value[index]?.getComputedTextLength?.()
    return width ? clamp((size * target) / width) : size
  })
}

// Cover the diagram only. The canvas also holds the notice strip below the
// diagram, and a watermark centred on the whole canvas ends up half under it.
const root = ref<SVGSVGElement | null>(null)
const diagramBox = ref<Record<string, string> | undefined>()
let observer: ResizeObserver | undefined

function trackDiagram() {
  const diagram = root.value?.previousElementSibling
  if (!(diagram instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
  const update = () => {
    diagramBox.value = diagram.offsetHeight > 0
      ? { top: `${diagram.offsetTop}px`, bottom: 'auto', height: `${diagram.offsetHeight}px` }
      : undefined
  }
  observer = new ResizeObserver(update)
  observer.observe(diagram)
  if (diagram.parentElement) observer.observe(diagram.parentElement)
  update()
}

onMounted(() => {
  fit()
  trackDiagram()
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => [props.headline, ...lines.value], fit)
</script>

<style scoped>
/* Above the diagram, below the viewer controls (zoom card z-index 2, floating
   pills z-index 5): see .viewer-canvas--license-notice in GenericViewer.vue,
   which makes the layering true. */
.license-watermark {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
  user-select: none;
}
</style>
