<template>
  <div
    v-if="error"
    class="error-container flex flex-col text-sm sticky bottom-0 z-[1]"
  >
    <div
      class="flex items-center justify-between gap-2 bg-slate-900 p-2 text-white"
    >
      <div class="flex w-fit items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-6 text-red-600"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div class="flex flex-col">
          <p>Syntax error</p>
        </div>
        <button
          v-if="isAiRepairEnabled"
          @click="showAIRepairDialog = true"
          class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1"
        >
          AI Repair
        </button>
      </div>
    </div>
    <output
      class="max-h-32 overflow-auto bg-slate-700 text-white border-t border-white/5 p-2 font-sans text-sm leading-6 whitespace-pre-wrap break-words"
      name="diagram-error"
      for="editor"
    >
      <pre
        class="m-0 bg-transparent font-inherit text-inherit whitespace-pre-wrap break-words"
        >{{ error?.toString() }}</pre
      >
    </output>
  </div>
  <AIRepair
    :show-dialog="showAIRepairDialog"
    :original-code="code"
    :diagram-type="diagramType"
    :error="error"
    @close="showAIRepairDialog = false"
    @apply="handleApplyRepair"
  />
</template>

<script setup>
import { computed, ref, onMounted } from "vue";
import { useStore } from "vuex";
import AIRepair from "@/components/AIRepair.vue";
import { DiagramType } from "@/model/Diagram/Diagram";
import getFeatureFlags from '@/apis/featureFlags';
const store = useStore();
const showAIRepairDialog = ref(false);
const aiRepairFeatureEnabled = ref(false);
// Get the error from the store
const error = computed(() => store.state.error);
// Get the current code from the store
const code = computed(() => {
  const diagramType = store.state.diagram.diagramType;
  return diagramType === DiagramType.Mermaid
    ? store.state.diagram.mermaidCode
    : store.state.diagram.code;
});
// Get the diagram type
const diagramType = computed(() => store.state.diagram.diagramType);
// Computed property to determine if AI repair is enabled
const isAiRepairEnabled = computed(() => {
  return aiRepairFeatureEnabled.value;
});
// Handle applying the repair
const handleApplyRepair = (repairedCode) => {
  const diagramType = store.state.diagram.diagramType;
  if (diagramType === DiagramType.Mermaid) {
    store.dispatch("updateMermaidCode", repairedCode);
  } else {
    store.dispatch("updateCode2", repairedCode);
  }
  showAIRepairDialog.value = false;
};
// Load the AI repair feature flag when component mounts
onMounted(async () => {
  try {
    const featureFlags = await getFeatureFlags(['AI_REPAIR']);
    aiRepairFeatureEnabled.value = featureFlags.AI_REPAIR?.enabled || false;
  } catch (error) {
    console.error('Failed to load AI repair feature flag:', error);
    aiRepairFeatureEnabled.value = false;
  }
});
</script>
<style scoped>
.error-container {
  flex-shrink: 0;
}
</style>