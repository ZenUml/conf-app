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
    >Hey,

I've been using ZenUML to draft sequence diagrams in our "<span class="pw-draft-token">{{ ctx.spaceKey }}</span>" Confluence space, and we've just hit the Lite limit (<span class="pw-draft-token">{{ ctx.macroCount }}</span> of <span class="pw-draft-token">{{ ctx.macrosLimit }}</span> macros). New edits are blocked until someone with billing access upgrades the space.

Two options when you have a moment:

  • ZenUML Marketplace plan — per-user monthly billing through Atlassian.
    <span class="pw-draft-token">{{ ctx.upgradeUrl }}</span>
  • Enterprise bundle — <span class="pw-draft-token">{{ ctx.enterpriseBundlePrice }}</span>, annual flat fee, includes the AI diagramming tools too.
    <span class="pw-draft-token">{{ ctx.enterpriseBundleUrl }}</span>

Could you take a quick look? Happy to send more details — I'm running into the limit on existing work and would love to keep moving.

Thanks!</div>
  </div>
</template>

<script setup lang="ts">
import type { AdvocacyMessageContext } from './buildAdvocacyMessage'

defineProps<{
  ctx: AdvocacyMessageContext
}>()
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
