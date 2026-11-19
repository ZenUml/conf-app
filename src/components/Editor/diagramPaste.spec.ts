import { describe, it, expect, vi } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { diagramPasteExtension, pasteFence } from './diagramPaste';

// jsdom has no layout; CodeMirror measures through Range.
document.createRange = () => {
  const range = new Range();
  range.getBoundingClientRect = vi.fn();
  range.getClientRects = () => ({ item: () => null, length: 0, [Symbol.iterator]: vi.fn() }) as any;
  return range;
};

const BODY = `sequenceDiagram
  autonumber
  participant R as Robot
  participant GW as Gateway<br/>(edge)
  R->>GW: request credential
  alt ok
    GW-->>R: credential
  end`;
const FENCED = '```mermaid\n' + BODY + '\n```';

describe.each(['mermaid', 'sequence'] as const)('diagramPasteExtension filter (%s)', (editorType) => {
  const make = (doc: string) =>
    EditorState.create({ doc, extensions: diagramPasteExtension(editorType, vi.fn()) });
  const paste = Transaction.userEvent.of('input.paste');

  it('removes the fence from a paste', () => {
    const tr = make('').update({ changes: { from: 0, insert: FENCED }, annotations: paste });
    expect(tr.newDoc.toString()).toBe(BODY);
    expect(tr.annotation(Transaction.userEvent)).toBe('input.paste');
    expect(tr.annotation(pasteFence)).toEqual({ language: 'mermaid' });
    expect(tr.newSelection.main.head).toBe(BODY.length);
  });

  it('removes the fence from a paste at the end of a document', () => {
    const state = make('%% notes\n');
    const tr = state.update({ changes: { from: state.doc.length, insert: FENCED }, annotations: paste });
    expect(tr.newDoc.toString()).toBe('%% notes\n' + BODY);
  });

  it('removes the fence from a paste that replaces a selection', () => {
    const state = make('old content');
    const tr = state.update({ changes: { from: 0, to: state.doc.length, insert: FENCED }, annotations: paste });
    expect(tr.newDoc.toString()).toBe(BODY);
  });

  it('does not rewrite typed input', () => {
    const tr = make('').update({
      changes: { from: 0, insert: FENCED },
      annotations: Transaction.userEvent.of('input.type'),
    });
    expect(tr.newDoc.toString()).toBe(FENCED);
  });

  it('does not rewrite a change with no user event', () => {
    const tr = make('').update({ changes: { from: 0, insert: FENCED } });
    expect(tr.newDoc.toString()).toBe(FENCED);
  });

  it('leaves a paste without a fence alone', () => {
    const tr = make('').update({ changes: { from: 0, insert: BODY }, annotations: paste });
    expect(tr.newDoc.toString()).toBe(BODY);
    expect(tr.annotation(pasteFence)).toBeUndefined();
  });
});

describe('diagramPasteExtension update listener', () => {
  const mount = (onPaste: any) => {
    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: diagramPasteExtension('mermaid', onPaste) }),
      parent: document.createElement('div'),
    });
    return view;
  };

  it('reports a fenced paste once with the rewritten text', () => {
    const onPaste = vi.fn();
    const view = mount(onPaste);
    view.dispatch({ changes: { from: 0, insert: FENCED }, userEvent: 'input.paste' });
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledWith({
      editorType: 'mermaid',
      pastedText: BODY,
      fenceRemoved: true,
      fenceLanguage: 'mermaid',
      docBefore: '',
      docAfter: BODY,
    });
    view.destroy();
  });

  it('reports a plain paste with no fence', () => {
    const onPaste = vi.fn();
    const view = mount(onPaste);
    view.dispatch({ changes: { from: 0, insert: BODY }, userEvent: 'input.paste' });
    expect(onPaste).toHaveBeenCalledWith(
      expect.objectContaining({ fenceRemoved: false, fenceLanguage: 'none', pastedText: BODY }),
    );
    view.destroy();
  });

  it('does not report typing', () => {
    const onPaste = vi.fn();
    const view = mount(onPaste);
    view.dispatch({ changes: { from: 0, insert: 'abc' }, userEvent: 'input.type' });
    expect(onPaste).not.toHaveBeenCalled();
    view.destroy();
  });

  it('survives a throwing handler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = mount(() => {
      throw new Error('boom');
    });
    expect(() => view.dispatch({ changes: { from: 0, insert: FENCED }, userEvent: 'input.paste' })).not.toThrow();
    expect(view.state.doc.toString()).toBe(BODY);
    warn.mockRestore();
    view.destroy();
  });
});
