import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { checkZenuml, zenumlDiagnostics } from './zenumlLinter';

const viewOf = (doc: string) => ({ state: EditorState.create({ doc }) }) as any;

describe('zenumlDiagnostics', () => {
  it('returns nothing for a passing parse', () => {
    expect(zenumlDiagnostics('A->B: hi', { pass: true, errorDetails: [] })).toEqual([]);
  });

  it('spans from the first error to one past the last, with the first message', () => {
    const doc = 'A->B: hi\nA->B.call(\n';
    const result = {
      pass: false,
      errorDetails: [
        { line: 2, column: 9, msg: "missing ')'" },
        { line: 2, column: 10, msg: 'mismatched input' },
      ],
    };
    // line 2 starts at offset 9
    expect(zenumlDiagnostics(doc, result)).toEqual([
      { from: 18, to: 20, severity: 'error', message: "missing ')'" },
    ]);
  });

  it('flags the whole document when the parse fails without details', () => {
    expect(zenumlDiagnostics('bad', { pass: false })).toEqual([
      { from: 0, to: 3, severity: 'error', message: 'Syntax error in zenuml diagram' },
    ]);
  });
});

describe('checkZenuml with the real headless parser', () => {
  it('passes valid code and reports broken code', async () => {
    expect(await checkZenuml(viewOf('A->B: hello'))).toEqual([]);
    const diagnostics = await checkZenuml(viewOf('A->B.method('));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
  });
});
