<template>
  <!--
    Mount the editor immediately so the fullscreen Forge iframe is populated
    with the diagram the user wanted to edit, then layer the upgrade modal on
    top via UpgradePrompt's own <Teleport to="body">. Save is already gated by
    `shouldBlockActions` in the persistence layer, so an editor mounted here
    cannot persist changes — the modal serves as the visible reminder.

    The editor component is passed in by each Forge entry point so the same
    wrapper works for sequence/mermaid (Workspace), graph (ForgeGraphEditor),
    OpenAPI (forge-swagger-editor mounts), and embed.

    The modal stays open until the user clicks "Continue editing" (or otherwise
    closes it). After dismiss, the editor remains so the user can read code,
    copy snippets, or just see what they're losing access to — they just can't
    save.
  -->
  <component :is="editor" v-bind="editorProps" />
  <UpgradePrompt
    :visible="modalVisible"
    :macros-created="macrosCreated"
    :macros-limit="macrosLimit"
    :upgrade-url="upgradeUrl"
    :enterprise-bundle-url="enterpriseBundleUrl"
    :macro-kind="macroKind"
    @close="onClose"
    @continue-editing="onContinueEditing"
  />
</template>

<script setup lang="ts">
import { ref, type Component } from 'vue'
import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage'

withDefaults(
  defineProps<{
    macrosCreated: number
    macrosLimit: number
    upgradeUrl: string
    enterpriseBundleUrl: string
    macroKind?: MacroKind
    editor: Component
    editorProps?: Record<string, unknown>
  }>(),
  { macroKind: 'unknown', editorProps: () => ({}) }
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
