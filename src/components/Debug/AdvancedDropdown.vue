<template>
  <div class="relative inline-flex items-center h-full">
    <button
      data-testid="advanced-trigger"
      class="inline-flex items-center gap-1.5 px-3 h-full text-gray-700 hover:bg-black/5 cursor-pointer border-none bg-transparent font-mono text-[11px]"
      @click="open = !open"
    >
      Advanced
      <span class="opacity-60">▾</span>
    </button>
    <div
      v-if="open"
      class="absolute top-full right-0 z-50 mt-0.5 w-[420px] bg-white border border-gray-300 rounded shadow-lg"
      @click.stop
    >
      <FlagsStatusTable v-if="!editing" />
      <FlagsEditor v-else @cancel="editing = false" />
      <div v-if="!editing" class="flex justify-end p-2 border-t border-gray-200">
        <button
          data-testid="advanced-edit"
          class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 cursor-pointer border-none font-mono text-[11px]"
          @click="editing = true"
        >Edit</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import FlagsStatusTable from './FlagsStatusTable.vue'
import FlagsEditor from './FlagsEditor.vue'

const open = ref(false)
const editing = ref(false)
</script>
