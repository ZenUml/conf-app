<template>
  <!--
    Option B — Dark devtools strip (Claude Design handoff vgw_9hp16f9Bt546DIMBQA).
    Goes dark so it reads instantly as developer-only chrome, clearly separate
    from the white app header below it; colour and glyphs carry the signal.
    Order is badge-led (product variant), env is icon-only (green = local
    tunnel), word-labels and vertical dividers dropped — spacing does the work.
  -->
  <aside
    role="status"
    aria-label="Debug information"
    class="relative z-50 h-[34px] pl-1.5 bg-[#1B1F27] border-b border-black/50 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)] font-mono text-[11px] leading-none text-[#9AA3B2] overflow-visible"
  >
    <div class="flex items-center h-full min-w-0">
      <div class="flex items-center h-full min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
      <!-- product variant badge (far left — carries the build identity) -->
      <div class="inline-flex items-center px-3.5 h-full" :title="'Build variant: ' + productType">
        <span
          :class="[
            'inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold font-sans flex-shrink-0',
            isLiteBuild ? 'bg-[#3B82F6] text-white' : 'bg-[#374151] text-[#D1D5DB]',
          ]"
        >{{ productTypeLabel.charAt(0) }}</span>
      </div>

      <!-- env — icon-only: green computer = local tunnel, muted cloud = deployed -->
      <div
        class="inline-flex items-center px-3.5 h-full"
        :title="overTunnel ? 'Served over Forge tunnel (local code)' : 'Served from deployed build'"
      >
        <IconComputer v-if="overTunnel" class="w-[13px] h-[13px] flex-shrink-0 text-[#4ADE80]" />
        <IconCloud v-else class="w-[13px] h-[13px] flex-shrink-0 text-[#6B7280]" />
      </div>

      <div class="inline-flex items-center gap-[7px] px-3.5 h-full">
        <IconGitBranch class="w-[13px] h-[13px] flex-shrink-0 text-[#6B7280]" />
        <span class="font-normal" :title="`${gitBranch || gitTag}:${commitHash}`"
          ><span class="text-[#D1D5DB]">{{ shortRef }}</span><span class="text-[#6B7280]">@{{ shortCommit }}</span></span
        >
      </div>

      <div class="inline-flex items-center gap-[7px] px-3.5 h-full">
        <IconFile class="w-[13px] h-[13px] flex-shrink-0 text-[#6B7280]" />
        <span class="text-[#6B7280] font-normal">{{ shortUuid || 'N/A' }}:{{ contentId || 'N/A' }}</span>
      </div>
      </div>

      <div class="flex items-center h-full flex-shrink-0 whitespace-nowrap">
      <button
        data-testid="debug-csat-banner"
        :class="[
          'inline-flex items-center gap-[7px] h-[22px] mr-2.5 px-[11px] rounded-md border font-mono text-[10.5px] font-semibold tracking-[0.04em] cursor-pointer transition-colors duration-150',
          csatArmed
            ? 'border-[#4ADE80]/35 bg-[#4ADE80]/[0.14] text-[#86EFAC] hover:bg-[#4ADE80]/[0.24]'
            : 'border-[#60A5FA]/30 bg-[#3B82F6]/[0.14] text-[#93C5FD] hover:bg-[#3B82F6]/[0.24]',
        ]"
        :title="csatArmed ? 'csatPending is set — click to disarm' : 'Set csatPending and reload to trigger the page banner'"
        @click="onTriggerCsatBanner"
      >CSAT<i
          :class="[
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            csatArmed ? 'bg-[#4ADE80]' : 'bg-[#60A5FA]',
          ]"
        />{{ csatArmed ? 'ON' : 'OFF' }}</button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import IconGitBranch from '@/components/icons/IconGitBranch.vue'
import IconFile from '@/components/icons/IconFile.vue'
import IconCloud from '@/components/icons/IconCloud.vue'
import IconComputer from '@/components/icons/IconComputer.vue'
import { MacroIdProvider } from '@/model/ContentProvider/MacroIdProvider'
import ApWrapper2 from '@/model/ApWrapper2'
import { getContext } from '@/model/globals/forgeGlobal'
import { markCsatPending, isCsatPendingFresh, clearCsatPending } from '@/utils/csat'

const commitHash = (import.meta as any).env?.VITE_APP_GIT_HASH ?? ''
const gitBranch = (import.meta as any).env?.VITE_APP_GIT_BRANCH ?? ''
const gitTag = (import.meta as any).env?.VITE_APP_GIT_TAG ?? ''
const productType = (import.meta as any).env?.PRODUCT_TYPE ?? 'lite'

// Over the Forge tunnel the iframe is served from the local Vite dev server
// (host = localhost:XXXX, seen in the tunnel's own CSP log). Deployed builds
// load from a Forge CDN host, never localhost.
const overTunnel =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)


const shortUuid = ref('')
const contentId = ref('')
const csatArmed = ref(false)

const productTypeLabel = computed(() => productType.toUpperCase())
const isLiteBuild = computed(() => productType === 'lite')

function truncate(value: string, max: number): string {
  if (!value) return value
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
const shortRef = computed(() => truncate(gitBranch || gitTag, 16))
const shortCommit = computed(() => truncate(commitHash, 7))

onMounted(async () => {
  const provider = new MacroIdProvider(new ApWrapper2() as any)
  shortUuid.value = (await provider.getUuid())?.substring(0, 8) ?? ''
  contentId.value = (await provider.getId()) ?? ''

  csatArmed.value = isCsatPendingFresh();
})

async function onTriggerCsatBanner() {
  if (csatArmed.value) {
    clearCsatPending();
    csatArmed.value = false;
    return;
  }
  const suppressionKey = Object.keys(localStorage).find(k => k.startsWith('csat_state-'));
  if (suppressionKey) localStorage.removeItem(suppressionKey);
  markCsatPending();
  // router.navigate reloads the full Confluence page so the pageBanner iframe
  // remounts and detects csatPending. window.location.reload() only reloads
  // this macro iframe, leaving the pageBanner's onMounted already-called state.
  const { router } = await import('@forge/bridge');
  const ctx = await getContext();
  const spaceKey = ctx?.extension?.space?.key;
  const pageId = ctx?.extension?.content?.id;
  if (spaceKey && pageId) {
    router.navigate(`/wiki/spaces/${spaceKey}/pages/${pageId}`);
  } else {
    window.location.reload();
  }
}
</script>
