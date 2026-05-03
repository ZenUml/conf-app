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
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M6 9l6 6l6 -6" />
  </svg>
</template>

<script setup lang="ts">
import { defineProps } from "vue";

defineProps<{
  width?: string;
  height?: string;
}>();
</script>
