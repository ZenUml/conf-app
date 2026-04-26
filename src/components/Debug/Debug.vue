<template>
  <DebugBar v-if="debug" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DebugBar from './DebugBar.vue'

const debug = computed(() => !!localStorage.zenumlDebug)
</script>
