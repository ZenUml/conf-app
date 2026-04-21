import {
  zenumlHighlighter,
  zenumlLinter,
  zenumlCompletions,
  zenumlCompletionKeyMaps,
  zenumlParticipantStateField,
} from '@zenuml/codemirror-extensions';
import { mermaidLinter } from '@/utils/mermaid/linter';
import { plantumlLinter } from '@/utils/plantuml/linter';
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  IndentContext,
  indentService,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  mermaid,
  mindmapTags,
  flowchartTags,
  ganttTags,
  sequenceTags,
  pieTags,
  requirementTags,
  journeyTags,
  mermaidTags,
} from 'codemirror-lang-mermaid';
import { closeBrackets, acceptCompletion, autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, indentWithTab, undo, redo } from '@codemirror/commands';
import { EditorState, EditorSelection, RangeSetBuilder, Transaction } from '@codemirror/state';
import { lineNumbers, placeholder, keymap, EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { dracula } from 'thememirror';

const mermaidHighlightStyle = HighlightStyle.define([
  { tag: mermaidTags.diagramName, color: '#81c784', fontWeight: 'bold' },
  { tag: flowchartTags.keyword, color: '#2cabf5' },
  { tag: flowchartTags.orientation, color: '#2cabf5' },
  { tag: flowchartTags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: flowchartTags.link, color: '#ff79c6' },
  { tag: flowchartTags.nodeEdge, color: '#ff79c6' },
  { tag: flowchartTags.nodeEdgeText, color: '#74f67a' },
  { tag: flowchartTags.nodeId, color: '#fff' },

  { tag: ganttTags.keyword, color: '#2cabf5' },
  { tag: ganttTags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: ganttTags.string, color: '#74f67a' },

  { tag: sequenceTags.arrow, color: '#ff79c6' },
  { tag: sequenceTags.keyword1, color: '#ff79c6' },
  { tag: sequenceTags.keyword2, color: '#ff79c6' },
  { tag: sequenceTags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: sequenceTags.messageText1, color: '#fff' },
  { tag: sequenceTags.messageText2, color: '#fff' },
  { tag: sequenceTags.nodeText, color: '#fff' },
  { tag: sequenceTags.position, color: '#fff' },

  { tag: pieTags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: pieTags.number, color: '#2cabf5' },
  { tag: pieTags.showData, color: '#2cabf5' },
  { tag: pieTags.string, color: '#74f67a' },
  { tag: pieTags.title, color: '#74f67a' },
  { tag: pieTags.titleText, color: '#74f67a' },

  { tag: mindmapTags.lineText1, color: '#ce9178' },
  { tag: mindmapTags.lineText2, color: '#74f67a' },
  { tag: mindmapTags.lineText3, color: '#e1bee7' },
  { tag: mindmapTags.lineText4, color: '#2cabf5' },
  { tag: mindmapTags.lineText5, color: '#ff79c6' },

  { tag: requirementTags.arrow, color: '#ff79c6' },
  { tag: requirementTags.keyword, color: '#2cabf5' },
  { tag: requirementTags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: requirementTags.number, color: '#2cabf5' },
  { tag: requirementTags.quotedString, color: '#81c784' },
  { tag: requirementTags.unquotedString, color: '#74f67a' },

  { tag: journeyTags.actor, color: '#ff79c6' },
  { tag: journeyTags.keyword, color: '#2cabf5' },
  { tag: journeyTags.lineComment, color: '#6272a4', fontStyle: 'italic' },
  { tag: journeyTags.score, color: '#2cabf5' },
  { tag: journeyTags.text, color: '#74f67a' },
]);

function customIndent(context: IndentContext, pos: number) {
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

const baseExtensionsFactory = (onEditorCodeChange: (code: string) => void) => [
  dracula,
  closeBrackets(),
  lineNumbers(),
  foldGutter(),
  bracketMatching(),
  history(),
  placeholder('Write you code here'),
  EditorState.tabSize.of(2),
  customIndentExtension,
  keymap.of([
    ...defaultKeymap,
    { key: 'Tab', run: acceptCompletion },
    { key: 'Enter', run: acceptCompletion },
    indentWithTab,
    { key: "Mod-z", run: undo, preventDefault: true },
    { key: "Mod-Shift-z", run: redo, preventDefault: true },
  ]),
  EditorView.lineWrapping,
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const updatedCode = update.state.doc.toString();
      onEditorCodeChange(updatedCode)
    }
  }),
];

const insertMermaidComment = (view: EditorView): boolean => {
  view.dispatch(view.state.changeByRange(range => ({
    changes: { from: range.from, insert: "%%  %% " },
    range: EditorSelection.cursor(range.from + 3)
  })));
  return true;
};

const mermaidExtensions = [
  mermaid(),
  syntaxHighlighting(mermaidHighlightStyle),
  mermaidLinter,
  keymap.of([
    { key: 'Mod-/', run: insertMermaidComment, preventDefault: true },
  ]),
]

const zenumlExtensions = [
  zenumlParticipantStateField,
  zenumlHighlighter('dark'),
  zenumlLinter(),
  autocompletion({
    override: [zenumlCompletions],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: true,
    selectOnOpen: true,
  }),
  keymap.of(zenumlCompletionKeyMaps),
]

// ── PlantUML: make @startuml / @enduml lines non-editable ────────────────────

const readonlyLineMark = Decoration.line({ class: 'cm-plantuml-readonly' });

const plantUmlReadonlyDecoration = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc;
      const first = doc.line(1);
      builder.add(first.from, first.from, readonlyLineMark);
      if (doc.lines > 1) {
        const last = doc.line(doc.lines);
        builder.add(last.from, last.from, readonlyLineMark);
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations }
);

const plantUmlReadonlyFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Allow programmatic changes (tab switching, store updates, AI generation)
  if (!tr.annotation(Transaction.userEvent)) return tr;
  
  const doc = tr.startState.doc;
  if (doc.lines < 2) return tr;
  
  const first = doc.line(1);
  const last = doc.line(doc.lines);
  const firstText = first.text;
  const lastText = last.text;
  
  // Calculate the editable range in the original document
  const editableStart = first.to + 1; // After first line and its newline
  const editableEnd = last.from - 1;   // Before last line's leading newline
  
  // Check if the change touches protected areas
  let touchesProtected = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    // If change touches first line content or last line content
    if (fromA < editableStart || toA > editableEnd) {
      touchesProtected = true;
    }
  });
  
  // If change doesn't touch protected areas, allow it
  if (!touchesProtected) {
    return tr;
  }
  
  // Change touches protected areas - need to adjust
  // Extract what the user is trying to insert
  let insertText = '';
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    const inserted = tr.newDoc.sliceString(fromB, toB);
    insertText += inserted;
  });
  
  // If user is pasting complete PlantUML code, extract only the middle content
  // Only match @startuml/@enduml as complete lines (with optional whitespace)
  const lines = insertText.split('\n');
  const startIdx = lines.findIndex(line => /^\s*@startuml\s*$/.test(line));
  const endIdx = lines.findIndex(line => /^\s*@enduml\s*$/.test(line));
  
  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    // Extract content between @startuml and @enduml
    const contentLines = lines.slice(startIdx + 1, endIdx);
    insertText = contentLines.join('\n');
  } else if (startIdx !== -1) {
    // Only has @startuml as a complete line, remove it
    const contentLines = lines.filter(line => !/^\s*@startuml\s*$/.test(line));
    insertText = contentLines.join('\n');
  } else if (endIdx !== -1) {
    // Only has @enduml as a complete line, remove it
    const contentLines = lines.filter(line => !/^\s*@enduml\s*$/.test(line));
    insertText = contentLines.join('\n');
  }
  
  // If there's no editable space (document is "@startuml\n@enduml")
  if (editableStart > editableEnd) {
    // Insert content between the lines
    if (insertText) {
      return {
        changes: {
          from: first.to + 1,
          to: first.to + 1,
          insert: insertText + '\n'
        }
      };
    }
    // If no content to insert (pure deletion), document is already minimal
    return [];
  }
  
  // Clamp the change to the editable range
  return {
    changes: {
      from: editableStart,
      to: editableEnd,
      insert: insertText
    }
  };
});

const plantUmlExtensions = [
  plantUmlReadonlyFilter,
  plantUmlReadonlyDecoration,
  plantumlLinter,
];

export { baseExtensionsFactory, mermaidExtensions, zenumlExtensions, plantUmlExtensions };