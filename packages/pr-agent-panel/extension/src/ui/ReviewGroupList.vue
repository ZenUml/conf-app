<script setup lang="ts">
import { computed } from 'vue'
import type { ReviewGroup, ReviewGroupPreparation, ReviewGroupItem } from '@zenuml/pr-panel-shared'

const props = defineProps<{
  group: ReviewGroup
  preparation: ReviewGroupPreparation | null
  currentPrNumber: number
  completedItem: ReviewGroupItem | null
  autoAdvance: boolean
  offline: boolean
}>()
const emit = defineEmits<{ open: [item: ReviewGroupItem]; next: []; stay: [] }>()

const ciLabel = { success: 'CI passed', failure: 'CI failed', pending: 'CI running', unknown: 'CI unknown' }
const key = (item: ReviewGroupItem) => `${item.pr.host}/${item.pr.owner}/${item.pr.repo}#${item.pr.number}`.toLowerCase()
const nextItem = computed(() => props.group.items.find((item) => item.outcome === 'pending') ?? null)
const remaining = computed(() => props.group.items.filter((item) => item.outcome === 'pending').length)
const rows = computed(() => props.group.items.filter((item) => item.outcome === 'pending' || (props.completedItem && key(item) === key(props.completedItem))))
</script>

<template>
  <aside class="prl rg" aria-label="Current review round">
    <header class="rg-header">
      <div class="rg-eyebrow">REVIEW ROUND</div>
      <h2>{{ group.product }}</h2>
      <p v-if="preparation?.error" class="rg-error">New round failed: {{ preparation.error }}</p>
      <p v-else-if="preparation" class="rg-note">Preparing a new round · showing the previous round</p>
      <p v-else-if="offline" class="rg-note">Offline · showing saved round. Reconnect in the extension popup.</p>
      <p v-else class="rg-note">{{ completedItem && !remaining ? 'Round complete' : `${remaining} remaining in this round` }}</p>
    </header>
    <ol class="rg-rows">
      <li v-for="item in rows" :key="key(item)">
        <div v-if="completedItem && key(item) === key(completedItem)" class="rg-row rg-row-completed" data-testid="completed-row">
          <span class="rg-title">{{ item.decisionTitle }}</span>
          <span class="rg-completed-label">{{ item.outcome === 'merged' ? 'Merged' : 'Closed' }} · completed</span>
        </div>
        <button v-else class="rg-row" :class="{ 'rg-row-current': !completedItem && item.pr.number === currentPrNumber, 'rg-row-next': completedItem && nextItem && key(item) === key(nextItem) }" type="button" @click="emit('open', item)">
          <span class="rg-title">{{ item.decisionTitle }}</span>
          <span class="rg-ci" :class="`rg-ci-${item.ci}`">{{ ciLabel[item.ci] }}</span>
        </button>
      </li>
    </ol>
    <div v-if="completedItem" class="rg-completion" role="status" aria-live="polite">
      <strong>{{ completedItem.outcome === 'merged' ? 'Merged' : 'Closed' }}</strong>
      <p v-if="nextItem" class="rg-completion-next">Next: {{ nextItem.decisionTitle }}</p>
      <p v-if="nextItem" class="rg-completion-hint">{{ autoAdvance ? 'Opening next in 3 seconds. Any interaction pauses it.' : 'Staying here. Open the next PR when ready.' }}</p>
      <p v-else class="rg-completion-hint">Round complete. No more PRs in this round.</p>
      <div v-if="nextItem" class="rg-completion-actions">
        <button class="rg-next" type="button" @click="emit('next')">Next PR</button>
        <button class="rg-stay" type="button" @click="emit('stay')">Stay</button>
      </div>
    </div>
  </aside>
</template>
