import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { PasteFenceLanguage } from '@/utils/analytics/catalog';
import { stripMarkdownFence } from '@/model/Diagram/markdownFence';

export type PasteEditorType = 'sequence' | 'mermaid';
export interface DiagramPasteReport {
  editorType: PasteEditorType;
  pastedText: string;
  fenceRemoved: boolean;
  fenceLanguage: PasteFenceLanguage;
  docBefore: string;
  docAfter: string;
}

// Carries the removed fence's language from the filter to the update listener.
export const pasteFence = Annotation.define<{ language: PasteFenceLanguage }>();

// Set when the filter kept the line break that separated the paste from the
// text before it, so the report can leave it out of `pastedText`.
const pasteSeparator = Annotation.define<boolean>();

// The single changed range of a paste, or null when the change has several.
function singleRange(tr: Transaction) {
  let count = 0;
  let range: { fromA: number; toA: number; fromB: number; toB: number } | null = null;
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    count++;
    range = { fromA, toA, fromB, toB };
  });
  return count === 1 ? range : null;
}

const isPaste = (tr: Transaction) => tr.docChanged && tr.isUserEvent('input.paste');

export function diagramPasteExtension(
  editorType: PasteEditorType,
  onPaste: (report: DiagramPasteReport) => void,
): Extension {
  const filter = EditorState.transactionFilter.of((tr) => {
    if (!isPaste(tr)) return tr;
    const range = singleRange(tr);
    if (!range) return tr;
    const { fromA, toA, fromB, toB } = range;
    const stripped = stripMarkdownFence(tr.newDoc.sliceString(fromB, toB));
    if (!stripped.fenced) return tr;
    // A paste that began on a new line must stay on a new line: dropping the
    // fence line must not glue the body onto the preceding text.
    const separator =
      /^\r?\n/.test(tr.newDoc.sliceString(fromB, toB)) &&
      fromA > 0 &&
      tr.startState.doc.sliceString(fromA - 1, fromA) !== '\n';
    const insert = separator ? '\n' + stripped.text : stripped.text;
    return {
      changes: { from: fromA, to: toA, insert },
      selection: { anchor: fromA + insert.length },
      annotations: [
        Transaction.userEvent.of('input.paste'),
        pasteFence.of({ language: stripped.language }),
        pasteSeparator.of(separator),
      ],
      scrollIntoView: true,
    };
  });

  // Lowest precedence: the base update listener writes the new document to the
  // store first, and the handler must see the store after that write.
  const listener = Prec.lowest(
    EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        if (!isPaste(tr)) continue;
        const range = singleRange(tr);
        if (!range) continue;
        const fence = tr.annotation(pasteFence);
        const inserted = tr.newDoc.sliceString(range.fromB, range.toB);
        try {
          onPaste({
            editorType,
            pastedText: tr.annotation(pasteSeparator) ? inserted.slice(1) : inserted,
            fenceRemoved: fence !== undefined,
            fenceLanguage: fence?.language ?? 'none',
            docBefore: tr.startState.doc.toString(),
            docAfter: tr.newDoc.toString(),
          });
        } catch (e) {
          console.warn('[diagram paste] handler failed', e);
        }
      }
    }),
  );

  return [filter, listener];
}
