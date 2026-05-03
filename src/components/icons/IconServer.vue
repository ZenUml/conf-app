<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="width || 24"
    :height="height || 24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
  </svg>
</template>

<script setup lang="ts">
import { defineProps } from "vue";

defineProps<{
  width?: string;
  height?: string;
}>();
</script>

