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
import EventBus from '@/EventBus';
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

// Title is part of the toolbar; after committing it with Enter, return the
// keyboard to the actual writing surface at the predictable first-line end.
// This is deliberately a selection update rather than a synthetic End key, so
// it behaves identically on every keyboard layout.
const focusFirstLineEnd = () => {
  const view = cmView.value;
  if (!view) return;
  const firstLine = view.state.doc.line(1);
  view.focus();
  view.dispatch({ selection: { anchor: firstLine.to }, scrollIntoView: true });
};

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
  EventBus.$on('focus-editor-first-line-end', focusFirstLineEnd);
})

onBeforeUnmount(() => {
  // Cancel the debounced validation function to avoid memory leaks
  validationRevision += 1;
  debouncedValidate.cancel();
  EventBus.$off('focus-editor-first-line-end', focusFirstLineEnd);
  cmView.value.destroy();
  resetEditorMutationSession();
  // Clear error state when component is unmounted
  store.dispatch('updateError', null);
})
</script>

<style>
.cm-editor {
  font-family: Menlo, 'Fira Code', Monaco, source-code-pro, "Ubuntu Mono", "DejaVu sans mono", Consolas, monospace;
  /* The DSL editor is a work surface, not a headline. It must not outscale
     the toolbar menu that controls it. */
  font-size: 12px;
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
