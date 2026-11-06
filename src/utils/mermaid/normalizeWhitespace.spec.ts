import { describe, it, expect } from 'vitest';
import { normalizeMermaidWhitespace } from './normalizeWhitespace';

// Written as an escape on purpose: a literal U+00A0 in source is invisible and
// survives neither review nor a stray formatter.
const NBSP = '\u00A0';

describe('normalizeMermaidWhitespace', () => {
  it('replaces a non-breaking space with a plain space', () => {
    expect(normalizeMermaidWhitespace(`pie title Pets\n${NBSP}${NBSP}"Dogs" : 386`))
      .toBe('pie title Pets\n  "Dogs" : 386');
  });

  it('replaces every occurrence, not just the first', () => {
    const input = `radar-beta\n${NBSP} axis a["A"]\n${NBSP} curve c["C"]{1}\n${NBSP} max 1`;
    const out = normalizeMermaidWhitespace(input) as string;
    expect(out).not.toContain(NBSP);
    expect(out.split('\n')).toHaveLength(4);
  });

  it('leaves a clean diagram byte-identical', () => {
    const clean = 'sequenceDiagram\n  Alice->>Bob: hi';
    expect(normalizeMermaidWhitespace(clean)).toBe(clean);
  });

  it('preserves newlines, tabs and ordinary spacing', () => {
    const input = 'flowchart TD\n\tA --> B\n  C --> D';
    expect(normalizeMermaidWhitespace(input)).toBe(input);
  });

  it('passes through empty, undefined and null without throwing', () => {
    expect(normalizeMermaidWhitespace('')).toBe('');
    expect(normalizeMermaidWhitespace(undefined)).toBe(undefined);
    expect(normalizeMermaidWhitespace(null as unknown as undefined)).toBe(null);
  });
});
