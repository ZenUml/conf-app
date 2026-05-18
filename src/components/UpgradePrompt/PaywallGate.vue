<template>
  <!--
    Wrap any content component (editor or viewer) with the upgrade modal on top.
    The content mounts immediately so the Forge iframe is never blank, then
    UpgradePrompt teleports its overlay to <body>.

    Editor use case (page editor / fullscreen editor):
      Save is gated by `shouldBlockActions` in the persistence layer, so the
      modal serves as the visible reminder — an editor mounted here cannot
      actually persist changes.

    Viewer use case (fullscreen viewer):
      The user is read-only by definition; the modal is the only friction.
      Dismissing leaves the diagram visible so they can keep looking.

    The modal stays open until the user clicks "Continue editing" or otherwise
    closes it. After dismiss, the underlying content remains mounted.
  -->
  <component :is="content" v-bind="contentProps" />
  <UpgradePrompt
    :visible="modalVisible"
    :macros-created="macrosCreated"
    :macros-limit="macrosLimit"
    :upgrade-url="upgradeUrl"
    :enterprise-bundle-url="enterpriseBundleUrl"
    :macro-kind="macroKind"
    :action-type="actionType"
    @close="onClose"
    @continue-editing="onContinueEditing"
  />
</template>

<script setup lang="ts">
import { ref, type Component } from 'vue'
import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage'
import type { PaywallActionType } from '@/utils/paywall/mountPaywallGate'

withDefaults(
  defineProps<{
    macrosCreated: number
    macrosLimit: number
    upgradeUrl: string
    enterpriseBundleUrl: string
    macroKind?: MacroKind
    content: Component
    contentProps?: Record<string, unknown>
    // Optional at the component boundary so direct test mounts work without
    // modifying scoring-adjacent tests. Production path (mountUnderPaywallGate)
    // requires actionType, so real events are always tagged.
    actionType?: PaywallActionType
  }>(),
  { macroKind: 'unknown', contentProps: () => ({}) }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'continue-editing'): void
}>()

const modalVisible = ref(true)

function onClose() {
  modalVisible.value = false
  emit('close')
}

function onContinueEditing() {
  modalVisible.value = false
  emit('continue-editing')
}
</script>
