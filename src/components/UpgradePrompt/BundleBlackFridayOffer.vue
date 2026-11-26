<template>
  <aside class="bundle-offer" aria-label="Black Friday offer">
    <strong>Black Friday · 50% off the first year</strong>
    <div>{{ BLACK_FRIDAY_PRICE }} for the first year. {{ BLACK_FRIDAY_TERMS }}</div>
    <div>{{ BLACK_FRIDAY_DEADLINE }}</div>
  </aside>
</template>

<script setup lang="ts">
import { BLACK_FRIDAY_PRICE, BLACK_FRIDAY_TERMS, BLACK_FRIDAY_DEADLINE } from '@/utils/paywall/bundleBlackFriday'
</script>

<style scoped>
.bundle-offer { margin: 0 0 12px; padding: 10px 14px; border-radius: 6px; background: #f3eefd; color: #4c2981; font-size: 12px; line-height: 18px; }
.bundle-offer strong { display: block; font-size: 14px; }
</style>
