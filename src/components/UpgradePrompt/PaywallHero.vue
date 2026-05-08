<template>
  <div class="grid grid-cols-[132px_1fr] gap-4 items-center px-4 pt-[18px] pb-1.5">
    <HeroPlaneAnimated />
    <div>
      <h3 class="text-base font-semibold text-gray-900 leading-[1.3] m-0">
        Send this to whoever runs your tooling budget.
      </h3>
      <p class="text-xs text-gray-600 leading-[1.45] m-0 mt-1">
        Usually a manager, team lead, or IT. We've drafted the request — explains the limit, the two upgrade paths, and what each costs. Just paste and send.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import HeroPlaneAnimated from './HeroPlaneAnimated.vue'
</script>
