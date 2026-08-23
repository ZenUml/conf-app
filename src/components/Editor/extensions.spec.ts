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
