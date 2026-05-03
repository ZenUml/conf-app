<template>
  <UpgradePrompt
    :visible="true"
    :macros-created="macrosCreated"
    :macros-limit="macrosLimit"
    :upgrade-url="upgradeUrl"
    :enterprise-bundle-url="enterpriseBundleUrl"
    @close="$emit('close')"
    @continue-editing="$emit('continue-editing')"
  />
</template>

<script setup lang="ts">
import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'

defineProps<{
  macrosCreated: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'continue-editing'): void
}>()
</script>
