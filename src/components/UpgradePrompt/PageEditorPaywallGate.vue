<template>
  <UpgradePrompt
    :visible="true"
    :macros-created="macrosCreated"
    :macros-limit="macrosLimit"
    :upgrade-url="upgradeUrl"
    :enterprise-bundle-url="enterpriseBundleUrl"
    :macro-kind="macroKind"
    @close="$emit('close')"
    @continue-editing="$emit('continue-editing')"
  />
</template>

<script setup lang="ts">
import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage'

withDefaults(
  defineProps<{
    macrosCreated: number
    macrosLimit: number
    upgradeUrl: string
    enterpriseBundleUrl: string
    macroKind?: MacroKind
  }>(),
  { macroKind: 'unknown' }
)

defineEmits<{
  (e: 'close'): void
  (e: 'continue-editing'): void
}>()
</script>
