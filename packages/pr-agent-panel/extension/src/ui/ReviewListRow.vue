<script setup lang="ts">
import type { ReviewSummary } from '@zenuml/pr-panel-shared'

defineProps<{
  item: ReviewSummary
  index: number
  selected: boolean
  measure?: boolean
}>()
const emit = defineEmits<{ open: [] }>()

function ordinal(index: number) {
  return String(index + 1).padStart(2, '0')
}

function statusOf(item: ReviewSummary): { text: string; dot: boolean } {
  switch (item.prState) {
    case 'draft': return { text: 'Draft', dot: false }
    case 'open': return { text: 'Open', dot: false }
    case 'merged': return { text: 'Merged', dot: false }
    case 'closed': return { text: 'Closed', dot: false }
    default: return { text: '', dot: false }
  }
}

function readinessOf(item: ReviewSummary) {
  switch (item.readiness ?? 'unknown') {
    case 'ready': return 'Ready to merge'
    case 'blocked': return 'Blocked'
    default: return 'Readiness unknown'
  }
}
</script>

<template>
  <li
    class="prl-row"
    :class="{ 'prl-row-selected': selected && !measure, 'prl-row-p0': item.priority === 'P0' }"
    :aria-current="!measure && selected ? 'page' : undefined"
    :tabindex="measure ? undefined : 0"
    :role="measure ? undefined : 'link'"
    :data-testid="measure ? undefined : 'list-row'"
    @click="!measure && emit('open')"
    @keydown.enter.prevent="!measure && emit('open')"
  >
    <div class="prl-meta" :class="{ 'prl-meta-draft': item.prState === 'draft' }">
      <span class="prl-meta-left">
        <span>{{ ordinal(index) }}</span>
        <span v-if="item.priority">{{ item.priority }}</span>
        <span>#{{ item.prNumber }}</span>
      </span>
      <span class="prl-status">
        <span v-if="item.stale" class="prl-stale" title="The PR changed after this review" :data-testid="measure ? undefined : 'stale-chip'">PR updated</span>
        <span v-if="statusOf(item).text"><span v-if="statusOf(item).dot" class="prl-dot"></span>{{ statusOf(item).text }}</span>
        <span v-if="item.conflict" title="Conflict reported at review time"><span class="prl-dot"></span>Review conflict</span>
      </span>
    </div>
    <div class="prl-readiness" :class="`prl-readiness-${item.readiness ?? 'unknown'}`">
      <span class="prl-readiness-label" :data-testid="measure ? undefined : 'readiness-label'">{{ readinessOf(item) }}</span>
      <span v-if="item.readinessReason" class="prl-readiness-reason" :title="item.readinessReason">{{ item.readinessReason }}</span>
    </div>
    <p class="prl-title" :title="item.headline">{{ item.headline }}</p>
    <p v-if="item.summary" class="prl-reason">{{ item.summary }}</p>
    <div v-if="item.tags.length" class="prl-tags">
      <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
    </div>
  </li>
</template>
