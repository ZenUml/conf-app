<template>
  <UpgradePromptRouter
    :visible="true"
    :macros-created="macrosCreated"
    :macros-limit="macrosLimit"
    :upgrade-url="upgradeUrl"
    :enterprise-bundle-url="enterpriseBundleUrl"
    :space-key="spaceKey"
    @close="$emit('close')"
    @continue-editing="$emit('continue-editing')"
  />
</template>

<script setup lang="ts">
import UpgradePromptRouter from '@/components/UpgradePrompt/UpgradePromptRouter.vue'

defineProps<{
  macrosCreated: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
  spaceKey?: string
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'continue-editing'): void
}>()
</script>
