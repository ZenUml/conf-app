<template>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <defs>
      <linearGradient :id="gradId" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#7C3AED" />
        <stop offset="100%" stop-color="#EC4899" />
      </linearGradient>
    </defs>
    <path d="M8 1.5L9.2 5.5L13 6.5L9.2 7.5L8 11.5L6.8 7.5L3 6.5L6.8 5.5L8 1.5Z" :fill="`url(#${gradId})`" />
    <path d="M12.5 0L13.2 2L15.5 2.5L13.2 3L12.5 5L11.8 3L9.5 2.5L11.8 2L12.5 0Z" :fill="`url(#${gradId})`" opacity="0.7" />
    <path d="M3 10L3.5 11.5L5 12L3.5 12.5L3 14L2.5 12.5L1 12L2.5 11.5L3 10Z" :fill="`url(#${gradId})`" opacity="0.5" />
  </svg>
</template>

<script setup lang="ts">
// Unique gradient id per instance so multiple sparks on a page don't collide.
const gradId = `spark-grad-${Math.random().toString(36).slice(2, 9)}`
</script>
