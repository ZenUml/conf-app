<template>
  <DebugBar v-if="debug" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DebugBar from './DebugBar.vue'

const debug = computed(() => {
  const isStandalone = typeof window !== 'undefined' && window.self === window.top
  return isStandalone || !!localStorage.zenumlDebug
})
</script>
