<script setup lang="ts">
/**
 * Left review list (Figma 184:5402). Rows arrive already sorted by the Hub
 * and only for PRs with a completed AI review; this component never re-sorts
 * and never shows a count. Search and the two filter chips narrow the rows
 * client-side; the ordinal keeps the Hub's rank. Merged PRs are hidden until
 * the state filter is set to Merged.
 */
import { computed, ref } from 'vue'
import type { Priority, PrState, ReviewSummary } from '@zenuml/pr-panel-shared'

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

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3']
const STATES: { value: PrState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
]

const rows = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/^#/, '')
  return props.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
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

function ordinal(index: number) {
  return String(index + 1).padStart(2, '0')
}

function statusOf(item: ReviewSummary): { text: string; dot: boolean } {
  if (item.conflict) return { text: 'Conflict', dot: true }
  switch (item.prState) {
    case 'draft':
      return { text: 'Draft', dot: false }
    case 'open':
      return { text: 'Open', dot: false }
    case 'merged':
      return { text: 'Merged', dot: false }
    case 'closed':
      return { text: 'Closed', dot: false }
    default:
      return { text: '', dot: false }
  }
}

function open(item: ReviewSummary, index: number) {
  emit('open', item, index)
}
</script>

<template>
  <nav class="prl" aria-label="AI reviews">
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
      <div class="prl-caption" data-testid="list-caption">AI reviews · by priority</div>
    </div>

    <ol v-if="rows.length" class="prl-rows">
      <li
        v-for="{ item, index } in rows"
        :key="item.runId"
        class="prl-row"
        :class="{ 'prl-row-selected': item.prNumber === currentPrNumber }"
        :aria-current="item.prNumber === currentPrNumber ? 'page' : undefined"
        tabindex="0"
        role="link"
        data-testid="list-row"
        @click="open(item, index)"
        @keydown.enter.prevent="open(item, index)"
      >
        <div class="prl-meta" :class="{ 'prl-meta-draft': item.prState === 'draft' }">
          <span class="prl-meta-left">
            <span>{{ ordinal(index) }}</span>
            <span v-if="item.priority">{{ item.priority }}</span>
            <span>#{{ item.prNumber }}</span>
          </span>
          <span class="prl-status">
            <span v-if="item.stale" class="prl-stale" title="The PR changed after this review" data-testid="stale-chip">PR updated</span>
            <span v-if="statusOf(item).text"><span v-if="statusOf(item).dot" class="prl-dot"></span>{{ statusOf(item).text }}</span>
          </span>
        </div>
        <p class="prl-title" :title="item.headline">{{ item.headline }}</p>
        <p v-if="item.summary" class="prl-reason">{{ item.summary }}</p>
        <div v-if="item.tags.length" class="prl-tags">
          <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
        </div>
      </li>
    </ol>
    <p v-else-if="items.length" class="prl-empty" data-testid="list-empty">No reviews match these filters.</p>
    <p v-else class="prl-empty" data-testid="list-empty">{{ emptyText ?? 'No completed AI reviews in this repository yet.' }}</p>
  </nav>
</template>
