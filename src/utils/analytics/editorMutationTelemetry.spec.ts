import { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  analyzeEditorTransaction,
  getEditorMutationSummary,
  recordEditorTransaction,
  resetEditorMutationSession,
  startEditorMutationSession,
  trackEditorMutationLifecycleEvent,
} from './editorMutationTelemetry';

function userTransaction(oldDoc: string, from: number, to: number, insert: string, userEvent: string) {
  return EditorState.create({ doc: oldDoc }).update({
    changes: { from, to, insert },
    annotations: Transaction.userEvent.of(userEvent),
  });
}

describe('analyzeEditorTransaction', () => {
  it('classifies a user paste over the complete old document as a full replacement', () => {
    const oldDoc = 'A -> B: hello';
    const transaction = userTransaction(oldDoc, 0, oldDoc.length, 'A -> B: goodbye', 'input.paste');

    expect(analyzeEditorTransaction(transaction, 'sequence')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'full',
      replaced_coverage_ratio: 1,
      editable_chars_before: oldDoc.length,
      inserted_chars: 'A -> B: goodbye'.length,
      input_method: 'paste',
    });
  });

  it('uses only the editable body between PlantUML sentinel lines as the replacement denominator', () => {
    const oldDoc = '@startuml\nAlice -> Bob: hello\n@enduml';
    const editableFrom = oldDoc.indexOf('\n') + 1;
    const editableTo = oldDoc.lastIndexOf('\n');
    const transaction = userTransaction(
      oldDoc,
      editableFrom,
      editableTo,
      'Alice -> Bob: goodbye',
      'input.paste',
    );

    expect(analyzeEditorTransaction(transaction, 'plantuml')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'full',
      replaced_coverage_ratio: 1,
      editable_chars_before: 'Alice -> Bob: hello'.length,
    });
  });

  it.each([
    ['input.type', 'typing'],
    ['delete.selection', 'delete'],
    ['input.drop', 'drop'],
    ['undo', 'undo'],
    ['redo', 'redo'],
    ['input.complete', 'unknown'],
  ])('normalizes CodeMirror user event %s to input method %s', (userEvent, expected) => {
    const oldDoc = 'abcdefghij';
    const transaction = userTransaction(oldDoc, 0, oldDoc.length, 'replacement', userEvent);

    expect(analyzeEditorTransaction(transaction, 'mermaid')).toMatchObject({
      kind: 'global_replace',
      input_method: expected,
    });
  });

  it('measures content delta separately from full replacement coverage', () => {
    const oldDoc = `${'a'.repeat(99)}x`;
    const newDoc = `${'a'.repeat(99)}y`;
    const transaction = userTransaction(oldDoc, 0, oldDoc.length, newDoc, 'input.paste');

    expect(analyzeEditorTransaction(transaction, 'sequence')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'full',
      content_delta_ratio: 0.01,
      content_delta_bucket: 'tiny',
    });
  });

  it('still observes a full replacement when the inserted text is identical', () => {
    const oldDoc = 'A -> B: hello';
    const transaction = userTransaction(oldDoc, 0, oldDoc.length, oldDoc, 'input.paste');

    expect(analyzeEditorTransaction(transaction, 'sequence')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'full',
      content_delta_ratio: 0,
      content_delta_bucket: 'none',
    });
  });

  it('observes a full-document deletion as a global replacement', () => {
    const oldDoc = 'A -> B: hello';
    const transaction = userTransaction(oldDoc, 0, oldDoc.length, '', 'delete.selection');

    expect(analyzeEditorTransaction(transaction, 'sequence')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'full',
      inserted_chars: 0,
      input_method: 'delete',
    });
  });

  it('keeps the 95% threshold explicit and labels it near_full', () => {
    const oldDoc = 'a'.repeat(100);
    const atThreshold = userTransaction(oldDoc, 0, 95, 'replacement', 'input.paste');
    const belowThreshold = userTransaction(oldDoc, 0, 94, 'replacement', 'input.paste');

    expect(analyzeEditorTransaction(atThreshold, 'mermaid')).toMatchObject({
      kind: 'global_replace',
      replace_scope: 'near_full',
      replaced_coverage_ratio: 0.95,
    });
    expect(analyzeEditorTransaction(belowThreshold, 'mermaid')).toMatchObject({
      kind: 'local_edit',
    });
  });

  it('ignores programmatic whole-document changes without Transaction.userEvent', () => {
    const state = EditorState.create({ doc: 'old document' });
    const transaction = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'new document' },
    });

    expect(analyzeEditorTransaction(transaction, 'sequence')).toBeNull();
  });
});

describe('editor mutation session', () => {
  it('does not start telemetry for create flows', () => {
    const tracked: Array<[string, Record<string, unknown>]> = [];
    const oldDoc = 'A -> B: hello';
    startEditorMutationSession({
      initialCode: oldDoc,
      macroType: 'sequence',
      operationMode: 'create',
      customContentId: null,
      journeyId: 'journey-create',
      sessionId: 'session-create',
      openedAt: 1_000,
    }, {
      track: (event, properties) => tracked.push([event, properties]),
    });

    recordEditorTransaction(
      userTransaction(oldDoc, 0, oldDoc.length, 'A -> B: goodbye', 'input.paste'),
    );

    expect(tracked).toEqual([]);
    expect(getEditorMutationSummary()).toEqual({});
  });

  it('emits every global replacement immediately with sequence and copy attribution', () => {
    const tracked: Array<[string, Record<string, unknown>]> = [];
    let now = 1_500;
    const oldDoc = 'A -> B: hello';
    startEditorMutationSession({
      initialCode: oldDoc,
      macroType: 'sequence',
      operationMode: 'edit',
      customContentId: '12345',
      journeyId: 'journey-1',
      sessionId: 'session-1',
      openedAt: 1_000,
    }, {
      now: () => now,
      track: (event, properties) => tracked.push([event, properties]),
      readAttribution: () => ({
        copy_id: 'copy-1',
        copy_source: 'copy_for_ai',
        copy_job: 'update',
        copied_at: 1_200,
        custom_content_id: '12345',
      }),
    });

    const first = userTransaction(oldDoc, 0, oldDoc.length, 'A -> B: goodbye', 'input.paste');
    recordEditorTransaction(first);
    now = 2_000;
    const second = userTransaction(first.newDoc.toString(), 0, first.newDoc.length, 'A -> C: goodbye', 'input.paste');
    recordEditorTransaction(second);

    expect(tracked).toHaveLength(2);
    expect(tracked[0]).toEqual(['editor_global_replace_observed', expect.objectContaining({
      journey_id: 'journey-1',
      session_id: 'session-1',
      replace_index: 1,
      ms_since_editor_open: 500,
      copy_id: 'copy-1',
      copy_source: 'copy_for_ai',
      copy_job: 'update',
      ms_since_copy: 300,
    })]);
    expect(tracked[1][1]).toMatchObject({ replace_index: 2, ms_since_editor_open: 1_000 });
    expect(getEditorMutationSummary()).toMatchObject({
      had_global_replace: true,
      global_replace_count: 2,
      post_replace_local_edit_count: 0,
      last_copy_id: 'copy-1',
    });

    resetEditorMutationSession();
  });

  it('attaches the replacement summary to real cancel and save-failure lifecycle events', () => {
    const tracked: Array<[string, Record<string, unknown>]> = [];
    const oldDoc = 'A -> B: hello';
    startEditorMutationSession({
      initialCode: oldDoc,
      macroType: 'sequence',
      operationMode: 'edit',
      customContentId: '12345',
      journeyId: 'journey-2',
      sessionId: 'session-2',
      openedAt: 1_000,
    }, {
      now: () => 1_500,
      track: (event, properties) => tracked.push([event, properties]),
      readAttribution: () => null,
    });
    recordEditorTransaction(userTransaction(oldDoc, 0, oldDoc.length, 'replacement', 'input.paste'));

    trackEditorMutationLifecycleEvent('macro_edit_cancelled');
    trackEditorMutationLifecycleEvent('macro_save_failed', 'network timeout');

    expect(tracked.slice(-2)).toEqual([
      ['macro_edit_cancelled', expect.objectContaining({
        journey_id: 'journey-2',
        had_global_replace: true,
        global_replace_count: 1,
      })],
      ['macro_save_failed', expect.objectContaining({
        journey_id: 'journey-2',
        had_global_replace: true,
        failure_reason: 'network timeout',
      })],
    ]);
    resetEditorMutationSession();
  });

  it('counts user-local transactions after a global replacement but excludes programmatic syncs', () => {
    const tracked: Array<[string, Record<string, unknown>]> = [];
    const oldDoc = 'a'.repeat(100);
    startEditorMutationSession({
      initialCode: oldDoc,
      macroType: 'sequence',
      operationMode: 'edit',
      customContentId: '12345',
      journeyId: 'journey-3',
      sessionId: 'session-3',
      openedAt: 1_000,
    }, {
      now: () => 1_500,
      track: (event, properties) => tracked.push([event, properties]),
      readAttribution: () => null,
    });

    const replacement = userTransaction(oldDoc, 0, oldDoc.length, 'b'.repeat(100), 'input.paste');
    recordEditorTransaction(replacement);
    const local = userTransaction(replacement.newDoc.toString(), 3, 4, 'c', 'input.type');
    recordEditorTransaction(local);
    const programmaticState = EditorState.create({ doc: local.newDoc });
    recordEditorTransaction(programmaticState.update({
      changes: { from: 0, to: programmaticState.doc.length, insert: 'd'.repeat(100) },
    }));

    expect(tracked.filter(([event]) => event === 'editor_global_replace_observed')).toHaveLength(1);
    expect(getEditorMutationSummary()).toMatchObject({
      global_replace_count: 1,
      post_replace_local_edit_count: 1,
    });
    resetEditorMutationSession();
  });
});
