<script setup lang="ts">
/**
 * Left review list (Figma 184:5402). P0 reviews remain above the paged list;
 * ordinary reviews show agent-ready items first. The ordinal still preserves
 * the Hub's business-priority rank. Search and filters narrow ordinary rows;
 * P0 remains visible even when those controls exclude it.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { effectiveReadiness, type Priority, type PrState, type ReviewSummary } from '@zenuml/pr-panel-shared'
import ReviewListRow from './ReviewListRow.vue'
import { pageContaining, paginateRows, type PageRange } from './pagination'

const props = withDefaults(
  defineProps<{
    items: ReviewSummary[]
    currentPrNumber?: number | null
    /** Shown instead of rows when there are none, e.g. while the Hub is not connected (nothing is known then). */
    emptyText?: string
  }>(),
  { currentPrNumber: null, emptyText: undefined },
)
const emit = defineEmits<{ open: [item: ReviewSummary, index: number] }>()

const query = ref('')
const priority = ref<'' | Priority>('')
const prState = ref<'' | PrState>('')
const rootEl = ref<HTMLElement | null>(null)
const viewportEl = ref<HTMLElement | null>(null)
const measureEl = ref<HTMLElement | null>(null)
const compact = ref(false)
const shortRow = ref(false)
const pages = ref<PageRange[]>([])
const pageIndex = ref(0)
let visibleAnchor: string | null = null
let resizeObserver: ResizeObserver | undefined
let observedRows = new Set<Element>()
let measureQueued = false

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']
const STATES: { value: PrState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
]

const filteredRows = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/^#/, '')
  return props.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (item.priority === 'P0') return false
      if (priority.value && item.priority !== priority.value) return false
      if (prState.value && item.prState !== prState.value) return false
      // A merged PR needs no more review: hidden unless the state filter asks for merged PRs,
      // except the row of the PR open in this tab.
      if (!prState.value && item.prState === 'merged' && item.prNumber !== props.currentPrNumber) return false
      if (!q) return true
      return (
        item.headline.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        String(item.prNumber).includes(q)
      )
    })
})

const pinnedRows = computed(() => props.items.map((item, index) => ({ item, index })).filter(({ item }) => item.priority === 'P0'))
const ordinaryRows = computed(() => filteredRows.value
  .sort((a, b) => Number(effectiveReadiness(b.item).readiness === 'ready') - Number(effectiveReadiness(a.item).readiness === 'ready')))

const visibleRows = computed(() => {
  const range = pages.value[pageIndex.value] ?? { start: 0, end: ordinaryRows.value.length }
  return ordinaryRows.value.slice(range.start, range.end)
})

function measure() {
  const root = rootEl.value
  const viewport = viewportEl.value
  const measuring = measureEl.value
  if (!root || !viewport || !measuring) return
  const shouldCompact = root.getBoundingClientRect().height > 0 && root.getBoundingClientRect().height < (pinnedRows.value.length ? 460 : 280)
  if (compact.value !== shouldCompact) {
    compact.value = shouldCompact
    scheduleMeasure()
    return
  }
  const heights = Array.from(measuring.querySelectorAll<HTMLElement>('.prl-row'), (row) => row.getBoundingClientRect().height)
  const viewportHeight = viewport.getBoundingClientRect().height
  const nextPages = paginateRows(heights, viewportHeight)
  const anchorIndex = ordinaryRows.value.findIndex(({ item }) => item.runId === visibleAnchor)
  const nextIndex = anchorIndex >= 0
    ? pageContaining(nextPages, anchorIndex)
    : Math.min(pageIndex.value, Math.max(0, nextPages.length - 1))
  if (JSON.stringify(nextPages) !== JSON.stringify(pages.value)) pages.value = nextPages
  pageIndex.value = nextIndex
  visibleAnchor = ordinaryRows.value[nextPages[nextIndex]?.start ?? 0]?.item.runId ?? null
  shortRow.value = heights.slice(nextPages[nextIndex]?.start, nextPages[nextIndex]?.end).some((height) => height > viewportHeight + 0.5)
  if (resizeObserver) {
    const currentRows = new Set(measuring.querySelectorAll('.prl-row'))
    for (const row of observedRows) if (!currentRows.has(row)) resizeObserver.unobserve(row)
    for (const row of currentRows) if (!observedRows.has(row)) resizeObserver.observe(row)
    observedRows = currentRows
  }
}

function scheduleMeasure() {
  if (measureQueued) return
  measureQueued = true
  void nextTick(() => {
    measureQueued = false
    measure()
  })
}

function setPage(index: number) {
  pageIndex.value = Math.max(0, Math.min(index, pages.value.length - 1))
  visibleAnchor = ordinaryRows.value[pages.value[pageIndex.value]?.start ?? 0]?.item.runId ?? null
  viewportEl.value?.scrollTo?.(0, 0)
  scheduleMeasure()
}

watch(ordinaryRows, (nextRows, oldRows) => {
  if (visibleAnchor && !nextRows.some(({ item }) => item.runId === visibleAnchor)) {
    const previousIndex = oldRows.findIndex(({ item }) => item.runId === visibleAnchor)
    visibleAnchor = nextRows[Math.min(Math.max(previousIndex, 0), nextRows.length - 1)]?.item.runId ?? null
  }
  scheduleMeasure()
}, { flush: 'post' })
watch(pinnedRows, scheduleMeasure, { flush: 'post' })
watch([query, priority, prState], () => {
  pageIndex.value = 0
  visibleAnchor = ordinaryRows.value[0]?.item.runId ?? null
  scheduleMeasure()
}, { flush: 'post' })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleMeasure)
    if (viewportEl.value) resizeObserver.observe(viewportEl.value)
  }
  window.addEventListener('resize', scheduleMeasure)
  void document.fonts?.ready.then(scheduleMeasure)
  scheduleMeasure()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleMeasure)
})

function open(item: ReviewSummary, index: number) {
  emit('open', item, index)
}
</script>

<template>
  <nav ref="rootEl" class="prl" :class="{ 'prl-compact': compact }" aria-label="AI reviews">
    <div class="prl-sticky">
      <div class="prl-controls">
        <input
          v-model="query"
          class="prl-search"
          type="search"
          placeholder="Search reviews"
          aria-label="Search reviews"
          data-testid="list-search"
        />
        <div class="prl-filters">
          <label class="prl-chip prl-chip-priority">
            <select v-model="priority" aria-label="Priority" data-testid="filter-priority">
              <option value="">All priorities ▾</option>
              <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }} ▾</option>
            </select>
          </label>
          <label class="prl-chip prl-chip-state">
            <select v-model="prState" aria-label="State" data-testid="filter-state">
              <option value="">All states ▾</option>
              <option v-for="s in STATES" :key="s.value" :value="s.value">{{ s.label }} ▾</option>
            </select>
          </label>
        </div>
      </div>
      <div class="prl-caption" data-testid="list-caption">AI reviews · 仅我的 PR · ready first</div>
    </div>

    <section v-if="pinnedRows.length" class="prl-pinned" :class="{ 'prl-pinned-only': !ordinaryRows.length }" aria-label="P0 reviews" data-testid="pinned-reviews">
      <div class="prl-pinned-caption">P0 · Highest priority</div>
      <ol class="prl-rows">
        <ReviewListRow
          v-for="{ item, index } in pinnedRows"
          :key="item.runId"
          :item="item"
          :index="index"
          :selected="item.prNumber === currentPrNumber"
          @open="open(item, index)"
        />
      </ol>
    </section>
    <div ref="viewportEl" class="prl-viewport" :tabindex="shortRow ? 0 : undefined" :aria-label="shortRow ? 'Review row; scroll to read the full review' : undefined">
      <ol v-if="ordinaryRows.length" class="prl-rows">
        <ReviewListRow
          v-for="{ item, index } in visibleRows"
          :key="item.runId"
          :item="item"
          :index="index"
          :selected="item.prNumber === currentPrNumber"
          @open="open(item, index)"
        />
      </ol>
      <p v-else-if="pinnedRows.length" class="prl-empty" data-testid="list-empty">{{ items.some((item) => item.priority !== 'P0') ? 'No other reviews match these filters.' : 'No other completed AI reviews.' }}</p>
      <p v-else-if="items.length" class="prl-empty" data-testid="list-empty">No reviews match these filters.</p>
      <p v-else-if="!pinnedRows.length" class="prl-empty" data-testid="list-empty">{{ emptyText ?? 'No completed AI reviews for your PRs here yet.' }}</p>
    </div>
    <div v-if="ordinaryRows.length" class="prl-pagination" aria-label="Review pages" data-testid="list-pagination">
      <button type="button" aria-label="Previous review page" data-testid="page-prev" :disabled="pageIndex === 0" @click="setPage(pageIndex - 1)">‹</button>
      <span data-testid="page-label">{{ shortRow ? 'Scroll row · ' : '' }}Page {{ pageIndex + 1 }} of {{ Math.max(1, pages.length) }}</span>
      <button type="button" aria-label="Next review page" data-testid="page-next" :disabled="pageIndex >= pages.length - 1" @click="setPage(pageIndex + 1)">›</button>
    </div>
    <ol v-if="ordinaryRows.length" ref="measureEl" class="prl-rows prl-measure" aria-hidden="true" inert>
      <ReviewListRow
        v-for="{ item, index } in ordinaryRows"
        :key="item.runId"
        :item="item"
        :index="index"
        :selected="false"
        measure
      />
    </ol>
  </nav>
</template>
