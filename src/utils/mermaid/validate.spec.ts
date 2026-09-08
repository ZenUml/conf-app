import { describe, it, expect, vi } from 'vitest';

// loadMermaid() fetches the vendored bundle over http, which the ESM loader
// refuses under vitest. Swap it for the npm package so these cases still run
// against the REAL parser — the same choice EditorTemplates.spec.ts makes,
// because what mermaid's own lexer accepts is the whole point here.
vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const mermaid = (await import('mermaid')).default;
  return { loadMermaid: async () => mermaid };
});

import { validateMermaidSyntax } from './validate';

const NBSP = '\u00A0';

// Mermaid's newer Langium grammars (pie, gitGraph, radar-beta,
// architecture-beta, packet-beta) reject U+00A0 as an unrecognised character;
// the older Jison ones (flowchart, sequenceDiagram, …) tolerate it. Rich-text
// paste is where the character comes from — four production macros rendered
// blank on every view because of it (investigated 2026-09-08).
describe('validateMermaidSyntax with pasted non-breaking spaces', () => {
  it('accepts a radar-beta diagram indented with NBSP', async () => {
    const dsl = [
      'radar-beta',
      `${NBSP} axis m["Math"], s["Science"]`,
      `${NBSP} curve a["Alice"]{85, 90}`,
      `${NBSP} max 100`,
      `${NBSP} min 0`,
    ].join('\n');

    const result = await validateMermaidSyntax(dsl);

    expect(result.error).toBeNull();
    expect(result.valid).toBe(true);
  });

  it('accepts a pie chart indented with NBSP', async () => {
    const dsl = `pie title Pets adopted by volunteers\n${NBSP}${NBSP}"Dogs" : 386\n${NBSP}${NBSP}"Cats" : 85`;

    const result = await validateMermaidSyntax(dsl);

    expect(result.valid).toBe(true);
  });

  it('still reports genuinely broken syntax as invalid', async () => {
    const result = await validateMermaidSyntax('radar-beta\n  axis [[[');

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
