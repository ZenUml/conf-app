<template>
  <div class="mx-4 mb-3 bg-white border border-gray-200 rounded-lg shadow-[0_1px_0_rgba(0,0,0,.02)] overflow-hidden">
    <div class="flex items-center gap-1.5 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-[.08em] text-gray-500">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
      <span>Your draft · paste this anywhere</span>
    </div>
    <div
      class="px-3.5 py-3 text-[12.5px] leading-[1.55] text-gray-800 whitespace-pre-wrap font-sans max-h-[240px] overflow-y-auto"
      data-testid="advocacy-draft-body"
    ><template v-for="(seg, i) in segments" :key="i"><span v-if="seg.type === 'token'" class="pw-draft-token">{{ seg.value }}</span><a v-else-if="seg.type === 'link'" :href="seg.value" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-700 hover:underline break-all">{{ seg.value }}</a><template v-else>{{ seg.value }}</template></template></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  advocacySegments,
  type AdvocacyMessageContext,
} from './buildAdvocacyMessage'

const props = defineProps<{
  ctx: AdvocacyMessageContext
}>()

const segments = computed(() => advocacySegments(props.ctx))
</script>

<style scoped>
.pw-draft-token {
  color: #1D4ED8;
  font-weight: 600;
  background: #EFF6FF;
  padding: 0 3px;
  border-radius: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11.5px;
}
</style>
