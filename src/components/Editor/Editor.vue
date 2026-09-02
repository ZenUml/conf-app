<template>
  <div class="flex flex-col h-full overflow-y-scroll">
    <div class="flex flex-col h-full justify-between">
      <div class="dsl-editor flex flex-1" ref="rootElement"> </div>
    </div>
  </div>

</template>

<script setup>
import {EditorView} from '@codemirror/view'
import globals from "@/model/globals";
import {DiagramType} from "@/model/Diagram/Diagram";
import { getCodeFromDiagram, getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import {EditorState, Compartment} from '@codemirror/state';
import {baseExtensionsFactory, mermaidExtensions, zenumlExtensions, plantUmlExtensions} from "./extensions";
import {computed, onMounted, ref, watch, onBeforeUnmount, onBeforeMount} from "vue";
import {useStore} from "vuex";
import { validateMermaidSyntax } from "@/utils/mermaid/validate";
import { validateSequenceSyntax } from "@/utils/sequence/validate";
import { validatePlantUmlSyntax } from "@/utils/plantuml/validate";
import { debounce } from 'lodash';
import {
  recordEditorTransaction,
  resetEditorMutationSession,
  startEditorMutationSession,
} from '@/utils/analytics/editorMutationTelemetry';
import {
  getEditJourneyId,
  getEditJourneyStartTime,
  getOrCreateSession,
} from '@/utils/journeyTracking';

const store = useStore();
const rootElement = ref();
const cmView = ref();
const canUserEdit = ref();

// Create a compartment for diagram-specific extensions
let diagramCompartment = new Compartment()

const diagramType = computed(() => store.state.diagram.diagramType);

const code = computed(() => getCodeFromDiagram(store.state.diagram, diagramType.value))

const onEditorCodeChange = (newCode) => {
  store.dispatch(getStoreUpdateAction(diagramType.value), newCode);
}

// Async parsers can finish out of order. Only the validation started for the
// latest code revision may publish an error to the shared store.
let validationRevision = 0;
const debouncedValidate = debounce(async (newCode, revision) => {
  let result;
  if (!newCode) {
    result = { error: null };
  } else if(diagramType.value===DiagramType.Mermaid){
    result = await validateMermaidSyntax(newCode);
  } else if(diagramType.value===DiagramType.PlantUml){
    result = await validatePlantUmlSyntax(newCode);
  } else {
    result = await validateSequenceSyntax(newCode);
  }

  if (revision === validationRevision) {
    store.dispatch('updateError', result.error);
  }
}, 1000);
// Watch for code changes and update error state
watch(code, (newCode) => {
  validationRevision += 1;
  // Any existing error describes the previous source. Clear it immediately;
  // the latest validation will restore an error if the new source is invalid.
  store.dispatch('updateError', null);
  debouncedValidate(newCode, validationRevision);
}, { immediate: true });

const diagramSpecificExtensions = computed(() => {
  if (diagramType.value === DiagramType.Mermaid) return mermaidExtensions;
  if (diagramType.value === DiagramType.PlantUml) return plantUmlExtensions;
  return zenumlExtensions;
});

watch(code, (newVal) => {
  if (newVal === cmView.value.state.doc.toString()) return

  cmView.value.dispatch({
    changes: {
      from: 0,
      to: cmView.value.state.doc.length,
      insert: newVal
    }
  })
})

const baseExtensions = computed(() => baseExtensionsFactory(onEditorCodeChange, recordEditorTransaction));

watch(diagramType, () => {
  cmView.value.dispatch({
    changes: {
      from: 0,
      to: cmView.value.state.doc.length,
      insert: code.value
    }
  });

  // Reconfigure only the diagram-specific extensions via the compartment
  cmView.value.dispatch({
    effects: diagramCompartment.reconfigure(diagramSpecificExtensions.value)
  });
})

onBeforeMount(async () => {
  canUserEdit.value = await globals.apWrapper.canUserEdit();
})

onMounted(() => {
  startEditorMutationSession({
    initialCode: code.value,
    macroType: diagramType.value,
    operationMode: store.state.diagram.id ? 'edit' : 'create',
    customContentId: store.state.diagram.id,
    journeyId: getEditJourneyId(),
    sessionId: getOrCreateSession(),
    openedAt: getEditJourneyStartTime() ?? Date.now(),
  });
  cmView.value = new EditorView({
    state: EditorState.create({
      doc: code.value,
      // Initialize with base extensions and the compartment holding the initial diagram extensions
      extensions: [
        ...baseExtensions.value,
        diagramCompartment.of(diagramSpecificExtensions.value)
      ]
    }),
    parent: rootElement.value,
  })
})

onBeforeUnmount(() => {
  // Cancel the debounced validation function to avoid memory leaks
  validationRevision += 1;
  debouncedValidate.cancel();
  cmView.value.destroy();
  resetEditorMutationSession();
  // Clear error state when component is unmounted
  store.dispatch('updateError', null);
})
</script>

<style>
.cm-editor {
  font-family: Menlo, 'Fira Code', Monaco, source-code-pro, "Ubuntu Mono", "DejaVu sans mono", Consolas, monospace;
  font-size: 15px;
  height: 100% !important;
  width: 100%;
}

.ͼ5 {
  color: #819fff
}

.cm-plantuml-readonly {
  opacity: 0.45;
  cursor: default;
  user-select: none;
}
</style>
