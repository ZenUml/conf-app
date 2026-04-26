<template>
  <aside
    role="status"
    aria-label="Debug information"
    class="flex items-center h-9 bg-gray-100 border-b border-gray-300 font-mono text-[11px] leading-none text-gray-600 overflow-x-auto whitespace-nowrap"
  >
    <div class="inline-flex items-center gap-1.5 px-3 h-full">
      <IconGitBranch class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
      <span class="text-gray-700 font-normal">{{ gitBranch || gitTag }}:{{ commitHash }}</span>
    </div>
    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <div class="inline-flex items-center gap-1.5 px-3 h-full">
      <IconFile class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
      <span class="text-gray-700 font-normal uppercase">[{{ shortUuid || 'N/A' }}]:{{ shortContentId }}</span>
    </div>
    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <div
      :class="[
        'inline-flex items-center gap-1.5 px-3 h-full font-semibold',
        isLiteBuild ? 'text-blue-500' : 'text-gray-400',
      ]"
      :title="'Build variant: ' + productType"
    >
      <span
        :class="[
          'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold flex-shrink-0',
          isLiteBuild ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-600',
        ]"
      >{{ productTypeLabel.charAt(0) }}</span>
      <span class="font-normal">{{ productTypeLabel }}</span>
    </div>
    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <div class="flex-1"></div>

    <PresetDropdown />
    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>
    <AdvancedDropdown />
    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <button
      data-testid="debug-clear"
      class="h-6 px-3 mr-2 border-none rounded text-[11px] font-medium font-mono cursor-pointer transition-all duration-150 bg-gray-200 text-gray-600 hover:bg-gray-300 active:bg-gray-400 active:text-white"
      title="Clear all paywall mocks and reload"
      @click="onClear"
    >Clear</button>
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import IconGitBranch from '@/components/icons/IconGitBranch.vue'
import IconFile from '@/components/icons/IconFile.vue'
import { MacroIdProvider } from '@/model/ContentProvider/MacroIdProvider'
import ApWrapper2 from '@/model/ApWrapper2'
import PresetDropdown from './PresetDropdown.vue'
import AdvancedDropdown from './AdvancedDropdown.vue'
import { applyPreset } from './presets'

const commitHash = (import.meta as any).env?.VITE_APP_GIT_HASH ?? ''
const gitBranch = (import.meta as any).env?.VITE_APP_GIT_BRANCH ?? ''
const gitTag = (import.meta as any).env?.VITE_APP_GIT_TAG ?? ''
const productType = (import.meta as any).env?.PRODUCT_TYPE ?? 'lite'

const shortUuid = ref('')
const contentId = ref('')

const productTypeLabel = computed(() => productType.toUpperCase())
const isLiteBuild = computed(() => productType === 'lite')
const shortContentId = computed(() => {
  if (!contentId.value) return 'N/A'
  if (contentId.value.length <= 5) return contentId.value
  return `..${contentId.value.slice(-5)}`
})

onMounted(async () => {
  const provider = new MacroIdProvider(new ApWrapper2() as any)
  shortUuid.value = (await provider.getUuid())?.substring(0, 8) ?? ''
  contentId.value = (await provider.getId()) ?? ''
})

function onClear() {
  applyPreset('Reset')
  window.location.reload()
}
</script>
