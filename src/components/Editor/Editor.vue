<template>
  <div class="flex flex-col h-full overflow-y-scroll">
    <div class="flex flex-col h-full justify-between">
      <div class="dsl-editor flex flex-1" ref="rootElement">
      </div>
    </div>
  </div>

</template>

<script setup>
import 'codemirror/keymap/sublime'
import {EditorView, keymap, lineNumbers, placeholder} from '@codemirror/view'
import globals from "@/model/globals";
import {DiagramType} from "@/model/Diagram/Diagram";
import {EditorState} from '@codemirror/state';
import {defaultKeymap, history, indentWithTab, redo, undo,} from '@codemirror/commands';
import {javascript} from '@codemirror/lang-javascript';
import {bracketMatching, syntaxHighlighting, defaultHighlightStyle, foldGutter} from "@codemirror/language";
import {okaidia} from '@uiw/codemirror-theme-okaidia';
import {computed, onMounted, ref, watch, onBeforeMount, onUnmounted} from "vue";

import {useStore} from "vuex";

const store = useStore()
const rootElement = ref();
const cmView = ref()

const diagramType = computed(() => store.state.diagram.diagramType)
const code = computed(() => diagramType === DiagramType.Mermaid ? store.state.diagram.mermaidCode : store.state.diagram.code)

const onEditorCodeChange = (newCode) => {
  const isMermaid = diagramType.value === 'mermaid';

  if (isMermaid) {
    store.dispatch('updateMermaidCode', newCode);
  } else {
    // TODO: rename the action updateCode2
    store.dispatch('updateCode2', newCode);
  }
}

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

watch(diagramType, () => {
  cmView.value.dispatch({
    changes: {
      from: 0,
      to: code.value.length,
      insert: code.value
    }
  })
})

onBeforeMount(async () => {
  this.canUserEdit = await globals.apWrapper.canUserEdit();
})

onMounted(() => {

  cmView.value = new EditorView({
    state: EditorState.create({
      doc: code.value,
      extensions: [
        okaidia,
        foldGutter(),
        javascript(),
        lineNumbers(),
        bracketMatching(),
        history(),
        syntaxHighlighting(defaultHighlightStyle),
        placeholder('Write you code here'),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        keymap.of([
          ...defaultKeymap,
          indentWithTab,
          {key: "Mod-z", run: undo, preventDefault: true},
          {key: "Mod-Shift-z", run: redo, preventDefault: true},
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const updatedCode = update.state.doc.toString();
            onEditorCodeChange(updatedCode)
          }
        }),
      ]
    }),
    parent: rootElement.value,
  })

  // NOTE: the highlight was broken due to unknown reason, need to be fixed in the future.

  /*EventBus.$on('highlight', (codeRange) => {
    if(that.mark) {
      that.mark.clear()
    }
    that.mark = cmEditor.markText({
      line: codeRange.start.line-1, ch: codeRange.start.col
    }, {
      line: codeRange.stop.line-1, ch: codeRange.stop.col
    }, {css: 'background: gray'})
  })
  cmEditor?.on('cursorActivity',_.debounce(() => {
    if (this.mark) {
      this.mark.clear()
    }
    const cursor = cmEditor.getCursor();
    const line = cursor.line;
    let pos = cursor.ch;

    for (let i = 0; i < line; i++) {
      pos += cmEditor.getLine(i).length + 1
    }
    that.$store.state.cursor = pos
  }, 500))*/
})

onUnmounted(() => {
  cmView.value.destroy();
})
</script>

<style>
.cm-editor {
  font-family: Menlo, 'Fira Code', Monaco, source-code-pro, "Ubuntu Mono", "DejaVu sans mono", Consolas, monospace;
  font-size: 15px;
  height: 100% !important;
  width: 100%;
}
</style>
