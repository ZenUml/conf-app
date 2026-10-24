import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { baseExtensionsFactory, plantUmlExtensions } from './extensions';
import { analyzeEditorTransaction } from '@/utils/analytics/editorMutationTelemetry';

describe('PlantUML readonly transaction filter', () => {
  it('preserves the userEvent annotation when it rewrites a full-document paste to the editable body', () => {
    const state = EditorState.create({
      doc: '@startuml\nAlice -> Bob: hello\n@enduml',
      extensions: plantUmlExtensions,
    });

    const transaction = state.update({
      changes: {
        from: 0,
        to: state.doc.length,
        insert: '@startuml\nAlice -> Bob: goodbye\n@enduml',
      },
      annotations: Transaction.userEvent.of('input.paste'),
    });

    expect(transaction.annotation(Transaction.userEvent)).toBe('input.paste');
    expect(transaction.newDoc.toString()).toBe('@startuml\nAlice -> Bob: goodbye\n@enduml');
    expect(analyzeEditorTransaction(transaction, 'plantuml')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'full',
      replaced_coverage_ratio: 1,
      editable_chars_before: 'Alice -> Bob: hello'.length,
    });
  });

  // conf-app#632. PlantUML allows `@startuml <Name>`; the filter used to match a
  // BARE marker only, so a named one survived as body text under the pinned line 1
  // and the document nested. Reproduced on production: the pasted markers stayed
  // and the two diagrams were fused into one picture with no error.
  const pasteInto = (doc: string, insert: string) => {
    const state = EditorState.create({ doc, extensions: plantUmlExtensions });
    return state.update({
      changes: { from: 0, to: state.doc.length, insert },
      annotations: Transaction.userEvent.of('input.paste'),
    }).newDoc.toString();
  };

  const SCAFFOLD = '@startuml\n\n@enduml';

  it('strips a pasted @startuml that carries a name', () => {
    const result = pasteInto(
      SCAFFOLD,
      '@startuml Alpha_Flow\nAlice -> Bob: hi\n@enduml',
    );

    expect(result).toBe('@startuml\nAlice -> Bob: hi\n@enduml');
    expect(result).not.toContain('Alpha_Flow');
  });

  it('strips a pasted @enduml that carries a name', () => {
    const result = pasteInto(SCAFFOLD, '@startuml\nAlice -> Bob: hi\n@enduml Alpha_Flow');

    expect(result).toBe('@startuml\nAlice -> Bob: hi\n@enduml');
  });

  it('keeps only the first diagram when a paste carries several', () => {
    // The macro renders one diagram. Merging them produced a picture the author
    // never wrote — silently, with no error, whenever the merge stayed parseable.
    const result = pasteInto(
      SCAFFOLD,
      '@startuml Alpha_Flow\nAlice -> Bob: hi\n@enduml\n\n@startuml Beta_Index\nclass C\n@enduml',
    );

    expect(result).toBe('@startuml\nAlice -> Bob: hi\n@enduml');
    expect(result).not.toContain('Beta_Index');
    expect(result).not.toContain('class C');
  });

  it('leaves a paste without markers alone', () => {
    expect(pasteInto(SCAFFOLD, 'Alice -> Bob: hi')).toBe('@startuml\nAlice -> Bob: hi\n@enduml');
  });
});

describe('base editor extensions', () => {
  it('forwards every accepted transaction to the mutation observer', () => {
    const onTransaction = vi.fn();
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'old',
        extensions: baseExtensionsFactory(vi.fn(), onTransaction),
      }),
    });

    view.dispatch({
      changes: { from: 0, to: 3, insert: 'new' },
      annotations: Transaction.userEvent.of('input.paste'),
    });

    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(onTransaction.mock.calls[0][0].newDoc.toString()).toBe('new');
    view.destroy();
  });
});
