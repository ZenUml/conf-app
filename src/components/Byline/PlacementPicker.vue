<template>
  <div class="picker" data-testid="placement-picker">
    <header class="picker__header">Choose where to add "{{ diagramName }}"</header>

    <main class="picker__page">
      <p v-if="state === 'loading'" class="picker__note" data-testid="placement-loading">Reading this page…</p>

      <div v-else-if="state !== 'ready'" class="picker__note" data-testid="placement-load-failed">
        <p>{{ state === 'forbidden' ? "You don't have permission to read this page." : "Couldn't read this page." }}</p>
        <button v-if="state === 'failed'" type="button" class="btn" data-testid="placement-retry" @click="load">Try again</button>
      </div>

      <article v-else class="adf">
        <h1 class="picker__title">{{ page!.title }}</h1>
        <template v-for="index in gapIndexes" :key="index">
          <!-- Real buttons, in document order, so the gaps are a keyboard path
               through the page as well as a mouse one. -->
          <button
            type="button"
            class="gap"
            :class="{ 'gap--selected': index === selected }"
            :aria-pressed="index === selected"
            :aria-label="gapDescription(index)"
            data-testid="placement-gap"
            @click="selected = index"
          >
            <template v-if="index === selected">
              <img class="gap__icon" :src="diagramIcon" alt="" />
              <span>{{ diagramName }} goes here</span>
            </template>
            <span v-else class="gap__hint">Add here</span>
          </button>
          <AdfPreview v-if="index < blockCount" :node="content[index]" />
        </template>
      </article>
    </main>

    <footer class="picker__footer">
      <span class="picker__where" data-testid="placement-where">{{ state === 'ready' ? gapDescription(selected) : '' }}</span>
      <button type="button" class="btn" data-testid="placement-cancel" @click="onCancel">Cancel</button>
      <button
        v-if="state === 'ready'"
        type="button"
        class="btn btn--primary"
        data-testid="placement-confirm"
        @click="onConfirm"
      >Add here</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AdfPreview, { blockLabel } from './AdfPreview'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import { toMacroType } from '@/utils/byline/pageDiagrams'
import { placementAt, type PlacementChoice } from '@/utils/byline/pagePlacement'
import {
  readPageForPlacement,
  type PageForPlacement,
  type PlacementDiagram,
  type PlacementSurface,
} from '@/utils/byline/placementPicker'

/**
 * "Where on the page?" — the page drawn from its ADF, with a gap between each
 * top-level block. ADF rather than Confluence's rendered HTML because a gap's
 * position then IS the position written back; matching rendered blocks to ADF
 * could put the diagram in the wrong place on a customer's page.
 *
 * Top-level only: a layout, panel or table counts as one block.
 *
 * This view chooses and closes. The surface that opened it does the write (see
 * utils/byline/placementPicker.ts).
 */
const props = withDefaults(
  defineProps<{
    pageId: string
    diagram: PlacementDiagram
    surface: PlacementSurface
    onChoose: (choice: PlacementChoice) => void | Promise<void>
    onDismiss: () => void | Promise<void>
    loadPage?: (pageId: string) => Promise<PageForPlacement>
  }>(),
  { loadPage: readPageForPlacement },
)

type Loaded = Extract<PageForPlacement, { status: 'ok' }>

const state = ref<'loading' | 'ready' | 'forbidden' | 'failed'>('loading')
const page = ref<Loaded | null>(null)
const selected = ref(0)
const content = computed(() => page.value?.content ?? [])
const blockCount = computed(() => content.value.length)
const gapIndexes = computed(() => Array.from({ length: blockCount.value + 1 }, (_, i) => i))
const diagramName = computed(() => props.diagram.title || 'This diagram')

/** Public-directory asset: relative and bound, as BylineDiagrams explains. */
const diagramIcon = './image/diagram_macro_icon.png'

const openedAt = Date.now()
let finished = false

const baseProps = () => ({
  feature_area: 'byline' as const,
  surface: props.surface,
  macro_type: toMacroType(props.diagram.diagramType) as MacroTypeValue,
})

function gapDescription(index: number): string {
  if (index >= blockCount.value) return 'At the end of the page'
  if (index === 0) return 'At the start of the page'
  return `After ${blockLabel(content.value[index - 1])}`
}

async function load() {
  state.value = 'loading'
  const read = await props.loadPage(props.pageId)
  if (read.status !== 'ok') {
    state.value = read.status
    trackAnalyticsEvent('placement_picker_opened', { ...baseProps(), result: 'load_failed' })
    return
  }
  page.value = read
  // The old one-click behaviour stays the default: the end of the page, always
  // a valid spot, so a user who just wants it added has one more click.
  selected.value = read.content.length
  state.value = 'ready'
  trackAnalyticsEvent('placement_picker_opened', {
    ...baseProps(),
    result: 'loaded',
    placement_block_count: read.content.length,
  })
}

function trackDismissed() {
  if (finished) return
  finished = true
  trackAnalyticsEvent('placement_picker_dismissed', { ...baseProps(), dwell_ms: Date.now() - openedAt })
}

function onCancel() {
  trackDismissed()
  void props.onDismiss()
}

function onConfirm() {
  if (!page.value) return
  finished = true
  const count = blockCount.value
  const index = selected.value
  void props.onChoose({
    placement: placementAt(content.value, index, page.value.version),
    position: index >= count ? 'end' : index === 0 ? 'start' : 'middle',
    blockCount: count,
    defaultKept: index === count,
  })
}

/** With focus inside this iframe, Escape never reaches the host's modal. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') onCancel()
}

onMounted(() => {
  // The modal's own X destroys this iframe without unmounting Vue.
  window.addEventListener('pagehide', trackDismissed)
  window.addEventListener('keydown', onKeydown)
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', trackDismissed)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.picker {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #172b4d;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

.picker__header {
  flex: none;
  padding: 12px 24px;
  border-bottom: 1px solid #dfe1e6;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker__page {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.adf {
  max-width: 760px;
  margin: 0 auto;
}

.picker__title {
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.25;
}

.picker__note {
  margin: 48px auto;
  text-align: center;
  color: #44546f;
}

.picker__footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-top: 1px solid #dfe1e6;
}

.picker__where {
  flex: 1 1 auto;
  min-width: 0;
  color: #44546f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn {
  flex: none;
  padding: 6px 12px;
  border: none;
  border-radius: 3px;
  background: rgba(9, 30, 66, 0.06);
  color: #172b4d;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.btn:hover {
  background: rgba(9, 30, 66, 0.12);
}

.btn--primary {
  background: #0c66e4;
  color: #fff;
}

.btn--primary:hover {
  background: #0055cc;
}

.gap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 20px;
  margin: 2px 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #0c66e4;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gap::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px dashed #c1c7d0;
}

.gap:hover::before,
.gap:focus-visible::before {
  border-top-color: #0c66e4;
}

.gap__hint {
  position: relative;
  padding: 0 8px;
  background: #fff;
  font-weight: 500;
  opacity: 0;
}

.gap:hover .gap__hint,
.gap:focus-visible .gap__hint {
  opacity: 1;
}

.gap--selected {
  justify-content: flex-start;
  margin: 8px 0;
  padding: 12px 14px;
  border: 2px solid #0c66e4;
  border-radius: 6px;
  background: #e9f2ff;
  color: #0055cc;
  font-size: 13px;
  font-weight: 500;
}

.gap--selected::before {
  display: none;
}

.gap__icon {
  width: 18px;
  height: 18px;
}

/* Rendered by AdfPreview, so outside this component's scope attribute. */
.adf :deep(p) { margin: 0; min-height: 1.55em; }
.adf :deep(h1), .adf :deep(h2), .adf :deep(h3), .adf :deep(h4), .adf :deep(h5), .adf :deep(h6) { margin: 8px 0 0; font-weight: 600; line-height: 1.3; }
.adf :deep(h1) { font-size: 24px; }
.adf :deep(h2) { font-size: 20px; }
.adf :deep(h3) { font-size: 17px; }
.adf :deep(h4), .adf :deep(h5), .adf :deep(h6) { font-size: 14px; }
.adf :deep(ul), .adf :deep(ol) { margin: 0; padding-left: 24px; }
.adf :deep(ul) { list-style: disc; }
.adf :deep(ol) { list-style: decimal; }
.adf :deep(.adf-tasks) { list-style: square; }
.adf :deep(blockquote) { margin: 0; padding-left: 14px; border-left: 2px solid #dfe1e6; color: #44546f; }
.adf :deep(hr) { margin: 8px 0; border: none; border-top: 2px solid #dfe1e6; }
.adf :deep(code) { padding: 1px 4px; border-radius: 3px; background: #f1f2f4; font-size: 12px; }
.adf :deep(.adf-link) { color: #0c66e4; }
.adf :deep(.adf-status) { padding: 0 4px; border-radius: 3px; background: #dfe1e6; font-size: 11px; font-weight: 600; }
.adf :deep(.adf-code) { margin: 0; padding: 10px 12px; overflow: hidden; border-radius: 3px; background: #f1f2f4; font-size: 12px; line-height: 1.5; }
.adf :deep(.adf-panel) { padding: 8px 12px; border-radius: 3px; background: #e9f2ff; }
.adf :deep(.adf-card) { padding: 12px 14px; overflow: hidden; border: 1px solid #dfe1e6; border-radius: 3px; background: #f7f8f9; color: #44546f; font-size: 13px; white-space: nowrap; text-overflow: ellipsis; }
.adf :deep(.adf-table) { overflow: hidden; }
.adf :deep(table) { width: 100%; border-collapse: collapse; font-size: 13px; }
.adf :deep(th), .adf :deep(td) { padding: 4px 8px; border: 1px solid #dfe1e6; text-align: left; vertical-align: top; }
.adf :deep(th) { background: #f7f8f9; font-weight: 600; }
.adf :deep(.adf-more) { padding-top: 4px; color: #626f86; font-size: 12px; }
.adf :deep(.adf-layout) { display: flex; gap: 16px; }
.adf :deep(.adf-column) { flex: 1 1 0; min-width: 0; }
</style>
