<template>
  <!-- AI Repair Dialog -->
  <div 
    v-if="showDialog" 
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click="closeDialog"
  >
    <div 
      class="bg-white rounded-lg shadow-xl w-11/12 max-w-4xl max-h-[90vh] flex flex-col"
      @click.stop
    >
      <div class="flex justify-between items-center border-b p-4">
        <h3 class="text-lg font-semibold">AI Repair</h3>
        <button 
          @click="closeDialog"
          class="text-gray-500 hover:text-gray-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="flex flex-1 overflow-hidden p-4 gap-4">
        <div class="flex-1 flex flex-col">
          <h4 class="font-medium mb-2">Original Code</h4>
          <div class="border rounded p-3 bg-gray-50 flex-1 overflow-auto font-mono text-sm whitespace-pre-wrap">
            {{ originalCode }}
          </div>
        </div>

        <div class="flex-1 flex flex-col">
          <h4 class="font-medium mb-2">Repaired Code</h4>
          <textarea
            v-model="repairResult"
            class="w-full h-full border rounded p-3 font-mono text-sm min-h-[200px] resize-none"
            :class="{
              'bg-white': repairResult,
              'bg-gray-100': !repairResult
            }"
            :readonly="!repairResult"
            placeholder="Generating repair suggestion..."
          ></textarea>
        </div>
      </div>

      <div class="flex justify-end gap-3 p-4 border-t">
        <button 
          @click="closeDialog"
          class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button 
          @click="applyRepair"
          :disabled="!repairResult"
          class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply Repair
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { fixDiagram } from "@/services/GenerateService";
const props = defineProps({
  showDialog: Boolean,
  originalCode: String,
  diagramType: Object,
  error: [String, Object]
});
const emit = defineEmits(['close', 'apply']);
const repairResult = ref(null);
// Method to close the AI repair dialog
const closeDialog = () => {
  emit('close');
  repairResult.value = null;
};
// Method to trigger AI repair using the fixDiagram service
const triggerAiRepair = async () => {
  try {
    // Call the fixDiagram service which returns the result without updating the store
    const result = await fixDiagram(props.originalCode, props.error?.toString() || 'Diagram syntax error', props.diagramType);
    repairResult.value = result.updatedCode;
  } catch (error) {
    console.error('Error during AI repair:', error);
    // Fallback to showing the error in the repair result
    repairResult.value = `Error during repair: ${error.message || 'Unknown error'}`;
  }
};
// Method to apply the repair result to the editor
const applyRepair = () => {
  if (repairResult.value && !repairResult.value.startsWith('Error during repair:')) {
    emit('apply', repairResult.value);
    closeDialog();
  }
};
// Watch for changes to the original code when the dialog is open
watch([() => props.originalCode, () => props.showDialog], ([newCode, showDialog]) => {
  if (showDialog && !repairResult.value) {
    // Trigger AI repair when dialog opens or code changes while dialog is open and no repair has been generated yet
    triggerAiRepair();
  }
});
</script>