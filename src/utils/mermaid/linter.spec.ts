import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const validateMermaidSyntaxMock = vi.hoisted(() =>
  vi.fn(async () => ({ valid: true, error: null, location: null })),
);
vi.mock('@/utils/mermaid/validate', () => ({
  validateMermaidSyntax: validateMermaidSyntaxMock,
}));

import { mermaidLinter } from '@/utils/mermaid/linter';

/** Run the linter's source function over a document, the way CodeMirror does. */
async function lint(doc: string) {
  const view = new EditorView({ state: EditorState.create({ doc }) });
  // `linter()` returns an extension array; the diagnostic source is the function
  // we passed in, reachable through the lint source facet.
  const source = (mermaidLinter as unknown as { linterSource?: unknown }).linterSource
    ?? (mermaidLinter as any)[0]?.value?.source
    ?? (mermaidLinter as any).source;
  if (typeof source !== 'function') throw new Error('cannot reach the linter source');
  const diagnostics = await source(view);
  view.destroy();
  return diagnostics;
}

const body = '\nflowchart TB\n  A --> B';

describe('mermaidLinter — silently ignored init directive', () => {
  beforeEach(() => {
    validateMermaidSyntaxMock.mockClear();
  });

  it('warns when mermaid would discard the directive', async () => {
    const doc = '%%{init: {"flowchart": {"nodeSpacing": , "rankSpacing": 70}}}%%' + body;

    const diagnostics = await lint(doc);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].from).toBe(0);
    // The author must be told mermaid DROPPED the config, not merely that it is malformed.
    expect(diagnostics[0].message).toMatch(/ignor/i);
    expect(diagnostics[0].message).toContain('default settings');
    // and it should quote the offending text back
    expect(diagnostics[0].message).toContain('"nodeSpacing": ,');
  });

  it('stays silent on a directive mermaid accepts', async () => {
    const doc = "%%{init: {'theme': 'forest'}}%%" + body;

    expect(await lint(doc)).toHaveLength(0);
  });

  it('reports a real syntax error as an error, not a warning', async () => {
    validateMermaidSyntaxMock.mockResolvedValueOnce({
      valid: false,
      error: 'Parse error on line 2',
      location: null,
    } as never);

    const diagnostics = await lint('flowchart TB\n  A -->');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
  });
});
