<template>
  <div class="locations" data-testid="diagram-locations">
    <button type="button" class="back-link" data-testid="diagram-locations-back" @click="emit('back')">← Plan and usage</button>

    <h1 class="locations-title">Diagram locations</h1>
    <p class="locations-intro">Find a diagram and open the page that owns it.</p>

    <p class="coverage-note" data-testid="diagram-locations-coverage">
      This list can miss diagrams and may not match the site count of {{ totalMacros.toLocaleString() }}. It shows the page that owns each diagram, not pages that embed it.
    </p>

    <div class="controls">
      <input
        v-model="queryInput"
        type="search"
        class="search-input"
        placeholder="Search diagrams or pages"
        aria-label="Search diagrams or pages"
        data-testid="diagram-locations-search"
        @keydown.enter.prevent="applyQuery"
      >
      <select
        v-model="spaceFilter"
        class="filter-select"
        aria-label="Space"
        data-testid="diagram-locations-space-filter"
        @change="onFilterChange('space')"
      >
        <option value="">All spaces</option>
        <option v-for="s in spaceRefs" :key="s.key" :value="s.key">{{ s.name || s.key }}</option>
      </select>
      <select
        v-model="typeFilter"
        class="filter-select"
        aria-label="Type"
        data-testid="diagram-locations-type-filter"
        @change="onFilterChange('type')"
      >
        <option value="">All types</option>
        <option v-for="t in typeOptions" :key="t" :value="t">{{ typeLabel(t) }}</option>
      </select>
    </div>

    <!-- Initial load: heading and coverage stay visible, no count yet. -->
    <template v-if="!rows.length && phase === 'loading'">
      <p class="results-heading" data-testid="diagram-locations-loading">Loading diagram locations…</p>
      <div class="skeleton" aria-hidden="true"><span /><span /><span /></div>
    </template>

    <template v-else-if="!rows.length && phase === 'failed'">
      <p class="error" data-testid="diagram-locations-failed">
        Could not load diagram locations.
        <button type="button" class="link-btn" data-testid="diagram-locations-retry" @click="retry">Retry</button>
      </p>
    </template>

    <!-- Settled with nothing listable: the empty state, never a failure in disguise. -->
    <section v-else-if="!rows.length" class="empty-state" data-testid="diagram-locations-none">
      <h2>No diagram locations available yet</h2>
      <p>Location details may still be catching up. A reported site count can exist without available locations.</p>
      <button type="button" class="btn btn-secondary" @click="emit('back')">Back to Plan and usage</button>
    </section>

    <template v-else>
      <h2
        ref="resultsHeading"
        tabindex="-1"
        class="results-heading"
        data-testid="diagram-locations-summary"
        aria-live="polite"
      >
        {{ summaryLine }}
      </h2>

      <section v-if="!filtered.length" class="empty-state" data-testid="diagram-locations-no-match">
        <h3>No matching diagrams</h3>
        <p>Try a different search or clear the space and type filters.</p>
        <button type="button" class="btn btn-secondary" data-testid="diagram-locations-clear" @click="clearFilters">
          Clear filters
        </button>
      </section>

      <template v-else>
        <div class="table-wrap">
          <table class="locations-table">
            <thead>
              <tr>
                <th>Diagram</th>
                <th>Type</th>
                <th>Space</th>
                <th>Owning page</th>
                <th class="action-col"><span class="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pageRows" :key="row.contentId" data-testid="diagram-locations-row">
                <td class="diagram-cell">{{ row.diagramTitle || 'Untitled diagram' }}</td>
                <td>{{ typeLabel(row.diagramType) }}</td>
                <td>{{ row.spaceName || row.spaceKey }}</td>
                <td class="page-cell">{{ pageLabel(row) }}</td>
                <td class="action-col">
                  <button
                    v-if="row.pageUrl"
                    type="button"
                    class="page-link"
                    data-testid="diagram-locations-page-link"
                    :aria-label="`Open page ${pageLabel(row)}`"
                    @click="openPage(row)"
                  >
                    Open page
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager" data-testid="diagram-locations-pager">
          <span class="range" data-testid="diagram-locations-range">{{ rangeLine }}</span>
          <div class="pager-nav">
            <button type="button" class="btn btn-secondary" data-testid="diagram-locations-prev" :disabled="page <= 1" @click="goTo(page - 1)">
              Previous
            </button>
            <button type="button" class="btn btn-secondary" data-testid="diagram-locations-next" :disabled="page >= pageCount" @click="goTo(page + 1)">
              Next
            </button>
          </div>
        </div>
      </template>

      <p class="load-status" data-testid="diagram-locations-status">
        <template v-if="phase === 'loading'">
          Loading more spaces… {{ loadedSpaceCount }} of {{ spaceRefs.length }}
        </template>
        <template v-else-if="phase === 'failed'">
          <span class="error">
            Could not load more diagram locations.
            <button type="button" class="link-btn" data-testid="diagram-locations-retry" @click="retry">Retry</button>
          </span>
        </template>
        <template v-else-if="phase === 'paused'">
          Loaded {{ rows.length.toLocaleString() }} diagrams from {{ loadedSpaceCount }} of {{ spaceRefs.length }} spaces.
          <button type="button" class="link-btn" data-testid="diagram-locations-more" @click="resume">Load more spaces</button>
        </template>
        <template v-else>
          Fetched at {{ formatTime(fetchedAt) }}
        </template>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import globals from '@/model/globals'
import { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { AnalyticsEventName, DiagramLocationsFilter } from '@/utils/analytics/catalog'
import type { AnalyticsProperties } from '@/utils/analytics/types'
import { ForgeRequestError } from '@/utils/forgeRequestError'
import { DiagramType } from '@/model/Diagram/Diagram'
import {
  confluenceGet,
  loadDiagramLocations,
  resolveSpaces,
  type DiagramLocationRow,
  type LocationsCursor,
  type SpaceRef,
  type SpaceSummary,
} from '@/utils/planUsage/diagramLocations'

const props = defineProps<{
  /** Spaces with a reported count, largest first, as /api/plan-usage lists them. */
  spaces: SpaceSummary[]
  /** The reported site total, quoted in the coverage note. */
  totalMacros: number
}>()
const emit = defineEmits<{ (e: 'back'): void }>()

// One fetch reads this many records (raw bodies, so the diagram type can be
// read); one run stops after this many records and offers "Load more
// spaces", so a site with thousands of diagrams never downloads them all
// behind one click.
const BATCH_LIMIT = 100
const RUN_RECORD_BUDGET = 500
const SEARCH_DEBOUNCE_MS = 300

type Phase = 'idle' | 'loading' | 'paused' | 'done' | 'failed'

const phase = ref<Phase>('idle')
const spaceRefs = ref<SpaceRef[]>([])
const rows = ref<DiagramLocationRow[]>([])
const fetchedAt = ref<string | null>(null)
const progress = new Map<string, { cursor: LocationsCursor | null; done: boolean }>()
let generation = 0
let batchIndex = 0

const queryInput = ref('')
const query = ref('')
const spaceFilter = ref('')
const typeFilter = ref('')
const page = ref(1)
const PAGE_SIZE = 10
const resultsHeading = ref<HTMLElement | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | undefined

// Same feature_area / surface as the sibling plan_usage_* events in
// PlanUsage.vue, so the whole page reads as one funnel in Mixpanel.
function track(name: AnalyticsEventName, extra: Partial<AnalyticsProperties> = {}) {
  trackAnalyticsEvent(name, { feature_area: 'upgrade', surface: 'dashboard', ...extra })
}

function contentTypes(): string[] {
  try {
    return globals.apWrapper.getMacroContentTypes()
  } catch (e) {
    console.warn('[plan-usage:locations] no content types', { error: (e as Error).message })
    return []
  }
}

const loadedSpaceCount = computed(() => spaceRefs.value.filter((s) => progress.get(s.key)?.done).length)

onMounted(() => {
  track('plan_usage_locations_shown', { space_count: props.spaces.length, macro_count: props.totalMacros })
  void start()
})

onBeforeUnmount(() => {
  generation++ // drop any response still in flight
  clearTimeout(debounceTimer)
})

async function start() {
  const gen = ++generation
  phase.value = 'loading'
  try {
    if (!spaceRefs.value.length) {
      spaceRefs.value = await resolveSpaces(confluenceGet, props.spaces.map((s) => s.spaceKey))
      if (gen !== generation) return
    }
    await run(gen)
  } catch (e) {
    fail(e, gen)
  }
}

// Load spaces in reported order (largest first), the filtered space first
// when one is selected, until every space is done or the run budget is spent.
async function run(gen: number) {
  let loadedThisRun = 0
  const order = [...spaceRefs.value].sort((a, b) =>
    (a.key === spaceFilter.value ? -1 : 0) - (b.key === spaceFilter.value ? -1 : 0))
  for (const space of order) {
    const p = progress.get(space.key) ?? { cursor: null, done: false }
    progress.set(space.key, p)
    while (!p.done) {
      const started = Date.now()
      const index = batchIndex++
      const batch = await loadDiagramLocations(confluenceGet, {
        space,
        types: contentTypes(),
        cursor: p.cursor,
        limit: BATCH_LIMIT,
      })
      if (gen !== generation) return
      rows.value = rows.value.concat(batch.rows)
      fetchedAt.value = batch.fetchedAt
      p.cursor = batch.next
      p.done = batch.next === null
      loadedThisRun += batch.rows.length + batch.hiddenCount
      track('plan_usage_locations_loaded', {
        load_outcome: batch.outcome,
        listed_count: batch.rows.length,
        hidden_count: batch.hiddenCount,
        has_more: batch.next !== null,
        page_index: index,
        duration_ms: Date.now() - started,
      })
      if (!p.done && loadedThisRun >= RUN_RECORD_BUDGET) {
        phase.value = 'paused'
        return
      }
    }
    if (loadedThisRun >= RUN_RECORD_BUDGET && spaceRefs.value.some((s) => !progress.get(s.key)?.done)) {
      phase.value = 'paused'
      return
    }
  }
  phase.value = 'done'
}

function fail(e: unknown, gen: number) {
  if (gen !== generation) return
  phase.value = 'failed'
  console.warn('[plan-usage:locations] load failed', { error: (e as Error)?.message })
  track('plan_usage_locations_load_failed', {
    load_outcome: 'failed',
    page_index: Math.max(0, batchIndex - 1),
    http_status: e instanceof ForgeRequestError ? e.status : undefined,
  })
}

// Search and filter values survive a retry; the loader resumes where it stopped.
function retry() {
  void start()
}

function resume() {
  void start()
}

// --- Search, filters, paging -----------------------------------------------

watch(queryInput, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(applyQuery, SEARCH_DEBOUNCE_MS)
})

function applyQuery() {
  clearTimeout(debounceTimer)
  const next = queryInput.value.trim()
  if (next === query.value) return
  query.value = next
  page.value = 1
  reportFilter('search')
}

function onFilterChange(kind: DiagramLocationsFilter) {
  page.value = 1
  reportFilter(kind)
  // A selected space that has not been read yet jumps the queue.
  if (kind === 'space' && spaceFilter.value && !progress.get(spaceFilter.value)?.done && phase.value !== 'loading') {
    void start()
  }
}

function clearFilters() {
  clearTimeout(debounceTimer)
  queryInput.value = ''
  query.value = ''
  spaceFilter.value = ''
  typeFilter.value = ''
  page.value = 1
  reportFilter('clear')
}

function goTo(target: number) {
  const bounded = Math.min(Math.max(1, target), pageCount.value)
  if (bounded === page.value) return
  page.value = bounded
  reportFilter('page')
  void nextTick(() => {
    resultsHeading.value?.focus()
    resultsHeading.value?.scrollIntoView?.({ block: 'start' })
  })
}

function reportFilter(kind: DiagramLocationsFilter) {
  track('plan_usage_locations_filtered', { locations_filter: kind, listed_count: filtered.value.length })
}

const typeOptions = computed(() => {
  const seen = new Set(rows.value.map((r) => r.diagramType))
  return Object.keys(TYPE_LABELS).filter((t) => seen.has(t)).concat(seen.has(DiagramType.Unknown) ? [DiagramType.Unknown] : [])
})

const filtered = computed(() => {
  const q = query.value.toLowerCase()
  return rows.value
    .filter((r) => !spaceFilter.value || r.spaceKey === spaceFilter.value)
    .filter((r) => !typeFilter.value || r.diagramType === typeFilter.value)
    .filter((r) => !q || r.diagramTitle.toLowerCase().includes(q) || (r.pageTitle ?? '').toLowerCase().includes(q))
    // Stable title + record id ordering, so paging never shuffles rows.
    .sort((a, b) => a.diagramTitle.localeCompare(b.diagramTitle, undefined, { sensitivity: 'base' }) || a.contentId.localeCompare(b.contentId))
})

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))

// Out-of-range recovery: when rows or filters change under the pager, fall back
// to the last valid page instead of showing a false empty page.
watch(pageCount, (count) => {
  if (page.value > count) page.value = count
})

const pageRows = computed(() => {
  const from = (page.value - 1) * PAGE_SIZE
  return filtered.value.slice(from, from + PAGE_SIZE)
})

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

const summaryLine = computed(() => {
  const list = filtered.value
  const pages = new Set(list.filter((r) => r.pageId).map((r) => `${r.containerKind}:${r.pageId}`)).size
  const spaces = new Set(list.map((r) => r.spaceKey)).size
  return `${plural(list.length, 'diagram', 'diagrams')} on ${plural(pages, 'page', 'pages')} in ${plural(spaces, 'space', 'spaces')}`
})

const rangeLine = computed(() => {
  const total = filtered.value.length
  const from = total === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1
  const to = Math.min(total, page.value * PAGE_SIZE)
  return `${from}–${to} of ${total.toLocaleString()}`
})

// --- Rows -------------------------------------------------------------------

async function openPage(row: DiagramLocationRow) {
  if (!row.pageUrl) return
  track('plan_usage_locations_page_clicked', {
    macro_type: row.macroType as AnalyticsProperties['macro_type'],
  })
  await openUrl(row.pageUrl)
}

const TYPE_LABELS: Record<string, string> = {
  [DiagramType.Sequence]: 'Sequence',
  [DiagramType.Mermaid]: 'Mermaid',
  [DiagramType.Markdown]: 'Markdown',
  [DiagramType.PlantUml]: 'PlantUML',
  [DiagramType.Graph]: 'Graph',
  [DiagramType.OpenApi]: 'OpenAPI',
  [DiagramType.AsyncApi]: 'AsyncAPI',
  [DiagramType.Embed]: 'Embed',
}

function typeLabel(diagramType: string): string {
  return TYPE_LABELS[diagramType] ?? 'Unknown'
}

function pageLabel(row: DiagramLocationRow): string {
  if (row.pageTitle) return row.pageTitle
  return row.containerKind === 'space' ? 'Not on a page' : 'Untitled page'
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
/* Same tokens as PlanUsage.vue (Radix slate/amber, Atlaskit blue); the root
   re-declares them so this component also renders on its own. */
.locations {
  --pu-text-high: #1C2024; /* Radix slate12 */
  --pu-text-low: #60646C; /* Radix slate11 */
  --pu-text-disabled: #8B8D98; /* Radix slate9 */
  --pu-hairline: #D9D9E0; /* Radix slate6 */
  --pu-control-border: #CDCED6; /* Radix slate7 */
  --pu-bg-subtle: #F9F9FB; /* Radix slate2 */
  --pu-warning: #AB6400; /* Radix amber11 */
  --pu-primary: #0C66E4; /* Atlaskit blue */
  color: var(--pu-text-high);
  font-size: 14px;
  line-height: 20px;
}
.back-link {
  font: inherit;
  font-weight: 500;
  color: var(--pu-text-low);
  background: none;
  border: none;
  padding: 0;
  margin: 0 0 16px;
  cursor: pointer;
}
.back-link:hover { color: var(--pu-text-high); }
.locations-title { font-size: 24px; font-weight: 600; line-height: 32px; margin: 0; }
.locations-intro { color: var(--pu-text-low); margin: 8px 0 12px; }
.coverage-note { font-size: 12px; line-height: 16px; color: var(--pu-text-low); max-width: 640px; margin: 0 0 16px; }

.controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 16px; }
.search-input {
  width: 400px;
  max-width: 100%;
  height: 32px;
  box-sizing: border-box;
  font: inherit;
  color: var(--pu-text-high);
  background: #FFFFFF;
  border: 0.5px solid var(--pu-control-border);
  border-radius: 6px;
  padding: 0 12px;
}
.search-input::placeholder { color: var(--pu-text-disabled); }
.filter-select {
  height: 32px;
  box-sizing: border-box;
  font: inherit;
  color: var(--pu-text-high);
  background: #FFFFFF;
  border: 0.5px solid var(--pu-control-border);
  border-radius: 6px;
  padding: 0 8px;
  min-width: 150px;
}
.search-input:focus-visible, .filter-select:focus-visible, .btn:focus-visible, .link-btn:focus-visible,
.page-link:focus-visible, .back-link:focus-visible, .results-heading:focus-visible {
  outline: 2px solid var(--pu-primary);
  outline-offset: 2px;
}

.results-heading { font-size: 12px; font-weight: 400; line-height: 16px; color: var(--pu-text-low); margin: 0 0 8px; }
.skeleton { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
.skeleton span { display: block; height: 12px; background: var(--pu-hairline); }
.skeleton span:nth-child(1) { width: 100%; }
.skeleton span:nth-child(2) { width: 85%; }
.skeleton span:nth-child(3) { width: 70%; }

.empty-state {
  background: var(--pu-bg-subtle);
  border: 0.5px solid var(--pu-control-border);
  border-radius: 6px;
  padding: 16px;
  margin: 0 0 16px;
}
.empty-state h2, .empty-state h3 { font-size: 14px; font-weight: 600; line-height: 20px; margin: 0 0 4px; }
.empty-state p { color: var(--pu-text-low); max-width: 560px; margin: 0 0 12px; }

.table-wrap { overflow-x: auto; margin: 0 0 16px; }
table.locations-table { width: 100%; border-collapse: collapse; }
.locations-table th {
  height: 32px;
  text-align: left;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--pu-text-low);
  padding: 0 16px 0 0;
  border-bottom: 0.5px solid var(--pu-control-border);
}
.locations-table td { height: 40px; padding: 0 16px 0 0; border-bottom: 0.5px solid var(--pu-hairline); vertical-align: middle; }
.diagram-cell { font-weight: 500; }
.page-cell { max-width: 260px; }
.action-col { text-align: right; white-space: nowrap; padding-right: 0 !important; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.page-link {
  font: inherit;
  font-weight: 500;
  color: var(--pu-primary);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.page-link:hover { text-decoration: underline; }

.pager { display: flex; align-items: center; justify-content: space-between; font-size: 12px; line-height: 16px; color: var(--pu-text-low); margin: 0 0 12px; }
.pager-nav { display: inline-flex; gap: 8px; }

.btn {
  font: inherit;
  font-weight: 500;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 0.5px solid transparent;
}
.btn-secondary { background: #FFFFFF; color: var(--pu-text-high); border-color: var(--pu-control-border); }
.btn-secondary:disabled { color: var(--pu-text-disabled); border-color: var(--pu-hairline); cursor: default; }

.load-status { font-size: 12px; line-height: 16px; color: var(--pu-text-low); margin: 0; }
.error { color: var(--pu-warning); margin: 0; }
.link-btn { font: inherit; font-weight: 500; color: var(--pu-primary); background: none; border: none; padding: 0; cursor: pointer; }
.link-btn:hover { text-decoration: underline; }
</style>
