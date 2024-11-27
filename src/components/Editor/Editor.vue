<template>
  <div class="flex flex-col h-full overflow-y-scroll">
    <div class="flex flex-col h-full justify-between">
      <div class="dsl-editor flex flex-1" ref="rootElement">
      </div>
    </div>
  </div>

</template>

<script setup>
import {EditorView, keymap, lineNumbers, placeholder} from '@codemirror/view'
import {closeBrackets, autocompletion} from "@codemirror/autocomplete";
import globals from "@/model/globals";
import {DiagramType} from "@/model/Diagram/Diagram";
import {EditorState} from '@codemirror/state';
import {defaultKeymap, history, indentWithTab, redo, undo,} from '@codemirror/commands';
import {javascript} from '@codemirror/lang-javascript';
import {
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
  foldGutter,
  indentService
} from "@codemirror/language";
import {computed, onMounted, ref, watch, onBeforeUnmount, onBeforeMount} from "vue";
import {dracula} from 'thememirror';
import {useStore} from "vuex";
import participantCompletionOptions from "@/constant/participantCompletionOptions";

const store = useStore();
const rootElement = ref();
const cmView = ref();
const canUserEdit = ref();

function participantCompletions(context) {
  let word = context.matchBefore(/(@\w*)/)

  if (!word)
    return null
  return {
    from: word.from,
    options: participantCompletionOptions
  }
}

const diagramType = computed(() => store.state.diagram.diagramType)

const code = computed(() => diagramType.value === DiagramType.Mermaid ? store.state.diagram.mermaidCode : store.state.diagram.code)

function customIndent(context, pos) {
  let line = context.lineAt(pos);
  let prevLine = pos > 0 ? context.lineAt(pos - 1) : null;

  // arrow pattern
  const arrowPattern = /^[a-z0-9]+->[a-z0-9]+([.:]\w+)?$/i;

  // method definition pattern
  const methodPattern = /^[a-z0-9.]+\w+\s*{$/i;

  // Check if the current line is inside braces
  if (prevLine) {
    const prevLineText = prevLine.text.trim();
    if (prevLineText.endsWith("{")) {
      return context.lineIndent(prevLine.from) + context.unit;
    }
  }

  // Check if the current line matches the arrow pattern
  if (arrowPattern.test(line.text.trim())) {
    return context.lineIndent(line.from);
  }

  // Check if the previous line matches the arrow pattern
  if (prevLine && arrowPattern.test(prevLine.text.trim())) {
    return context.lineIndent(prevLine.from);
  }

  // Check if the previous line is a method definition
  if (prevLine && methodPattern.test(prevLine.text.trim())) {
    return context.lineIndent(prevLine.from) + context.unit;
  }


  return null;
}

const customIndentExtension = indentService.of((context, pos) => customIndent(context, pos));

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
  canUserEdit.value = await globals.apWrapper.canUserEdit();
})

onMounted(() => {
  cmView.value = new EditorView({
    state: EditorState.create({
      doc: code.value,
      extensions: [
        dracula,
        javascript(),
        closeBrackets(),
        lineNumbers(),
        foldGutter(),
        bracketMatching(),
        history(),
        syntaxHighlighting(defaultHighlightStyle),
        placeholder('Write you code here'),
        EditorState.tabSize.of(2),
        customIndentExtension,
        keymap.of([
          ...defaultKeymap,
          indentWithTab,
          {key: "Mod-z", run: undo, preventDefault: true},
          {key: "Mod-Shift-z", run: redo, preventDefault: true},
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const updatedCode = update.state.doc.toString();
            onEditorCodeChange(updatedCode)
          }
        }),
        autocompletion({
          override: [participantCompletions],
          activateOnTyping: true
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

onBeforeUnmount(() => {
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

.ͼ5 {
  color: #819fff
}
</style>
