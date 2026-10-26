<script setup lang="ts">
import type { ReviewGroup, ReviewGroupPreparation, ReviewGroupItem } from '@zenuml/pr-panel-shared'

defineProps<{
  group: ReviewGroup
  preparation: ReviewGroupPreparation | null
  currentPrNumber: number
  offline: boolean
}>()
const emit = defineEmits<{ open: [item: ReviewGroupItem] }>()

const ciLabel = { success: 'CI passed', failure: 'CI failed', pending: 'CI running', unknown: 'CI unknown' }
</script>

<template>
  <aside class="prl rg" aria-label="Current review round">
    <header class="rg-header">
      <div class="rg-eyebrow">REVIEW ROUND</div>
      <h2>{{ group.product }}</h2>
      <p v-if="preparation?.error" class="rg-error">New round failed: {{ preparation.error }}</p>
      <p v-else-if="preparation" class="rg-note">Preparing a new round · showing the previous round</p>
      <p v-else-if="offline" class="rg-note">Offline · showing saved round. Reconnect in the extension popup.</p>
      <p v-else class="rg-note">{{ group.items.filter(item => item.outcome === 'pending').length }} remaining in this round</p>
    </header>
    <ol class="rg-rows">
      <li v-for="item in group.items.filter(item => item.outcome === 'pending')" :key="`${item.pr.owner}/${item.pr.repo}#${item.pr.number}`">
        <button class="rg-row" :class="{ 'rg-row-current': item.pr.number === currentPrNumber }" type="button" @click="emit('open', item)">
          <span class="rg-title">{{ item.decisionTitle }}</span>
          <span class="rg-ci" :class="`rg-ci-${item.ci}`">{{ ciLabel[item.ci] }}</span>
        </button>
      </li>
    </ol>
  </aside>
</template>
