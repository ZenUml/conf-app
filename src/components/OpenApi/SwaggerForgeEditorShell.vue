<!--
  React OpenAPI/Swagger toolbar + SwaggerEditorBundle mount into this div (same as
  rendering into #app on the non-paywall path). Used as PageEditorPaywallGate's
  `editor` so the preview + modal sit on top of a real editor shell — Continue
  only dismisses the modal (see forge-graph-editor.ts pattern).
-->
<template>
  <div
    id="openapi-bootstrap-root"
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    style="height: 100vh"
  />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

const props = defineProps<{
  /** Runs Swagger React bootstrap + document hydration after the shell is in the DOM */
  onMountedBootstrap?: () => void | Promise<void>
}>()

onMounted(() => {
  void props.onMountedBootstrap?.()
})
</script>
