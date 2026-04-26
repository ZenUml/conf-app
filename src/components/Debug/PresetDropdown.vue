<template>
  <div class="relative inline-flex items-center h-full">
    <button
      data-testid="preset-trigger"
      class="inline-flex items-center gap-1.5 px-3 h-full text-gray-700 hover:bg-black/5 cursor-pointer border-none bg-transparent font-mono text-[11px]"
      @click="open = !open"
    >
      <span class="opacity-60">Preset:</span>
      <span data-testid="preset-active" class="font-semibold">{{ active ?? '—' }}</span>
      <span class="opacity-60">▾</span>
    </button>
    <ul
      v-if="open"
      class="absolute top-full left-0 z-50 mt-0.5 min-w-[260px] bg-white border border-gray-300 rounded shadow-lg font-mono text-[11px] py-1 list-none m-0"
      @click.stop
    >
      <li
        v-for="p in PRESETS"
        :key="p.name"
        data-testid="preset-item"
        class="px-3 py-1.5 cursor-pointer hover:bg-gray-100 text-gray-800"
        @click="onSelect(p.name)"
      >
        {{ p.name }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { PRESETS, applyPreset, findActivePreset } from './presets'

const open = ref(false)
const active = ref<string | null>(findActivePreset())

function onSelect(name: string) {
  applyPreset(name)
  active.value = name
  open.value = false
  window.location.reload()
}
</script>
