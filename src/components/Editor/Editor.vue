<template>
  <div class="flex flex-col h-full overflow-y-scroll">
    <div class="flex flex-col h-full justify-between">
      <div v-show="!store.state.generating" class="dsl-editor flex flex-1" ref="rootElement"> </div>
      <div v-if="store.state.generating" style="margin-top: 2px;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block" class="tabler-icon tabler-icon-loader-2 h-5 w-5 animate-spin text-primary"><path d="M12 3a9 9 0 1 0 9 9"></path></svg> Generating diagram code ...</div>
    </div>
  </div>

</template>

<script setup>
import {EditorView} from '@codemirror/view'
import globals from "@/model/globals";
import {DiagramType} from "@/model/Diagram/Diagram";
import { getCodeFromDiagram, getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import {EditorState, Compartment} from '@codemirror/state';
import {baseExtensionsFactory, mermaidExtensions, zenumlExtensions} from "./extensions";
import {computed, onMounted, ref, watch, onBeforeUnmount, onBeforeMount} from "vue";
import {useStore} from "vuex";
import { validateMermaidSyntaxForStore } from "@/utils/mermaid/validate";
import { validateSequenceSyntaxForStore } from "@/utils/sequence/validate";
import { debounce } from 'lodash';

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

// Create a unified debounced validation function
const debouncedValidate = debounce(async (newCode) => {
  if (!newCode) {
    store.dispatch('updateError', null);
    return;
  }
  if(diagramType.value===DiagramType.Mermaid){
    await validateMermaidSyntaxForStore(newCode, store, 'updateError');
  } else {
    await validateSequenceSyntaxForStore(newCode, store, 'updateError');
  }
}, 1000);
// Watch for code changes and update error state
watch(code, (newCode) => {
  debouncedValidate(newCode);
}, { immediate: true });

const diagramSpecificExtensions = computed(() => 
  diagramType.value === DiagramType.Mermaid ? mermaidExtensions : zenumlExtensions
);

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

const baseExtensions = computed(() => baseExtensionsFactory(onEditorCodeChange));

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
  debouncedValidate.cancel();
  cmView.value.destroy();
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
</style>
