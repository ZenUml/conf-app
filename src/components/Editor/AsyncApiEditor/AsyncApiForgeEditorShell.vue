<!--
  React AsyncApiStudioEditor mounts into this div (same as rendering into
  #app on the non-paywall path). Used as PaywallGate's `content` so the
  preview + modal sit on top of a real editor shell — Continue only
  dismisses the modal. Mirrors SwaggerForgeEditorShell.vue.
-->
<template>
  <div
    id="asyncapi-bootstrap-root"
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    style="height: 100vh"
  />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

const props = defineProps<{
  /** Mounts the Studio React tree after the shell is in the DOM */
  onMountedBootstrap?: () => void | Promise<void>
}>()

onMounted(() => {
  void props.onMountedBootstrap?.()
})
</script>
