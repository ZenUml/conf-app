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

// Both diagram types shipped in mermaid 11.13.0. On 11.12.2 they failed with
// "No diagram type detected matching given configuration for text: venn-beta",
// which is what two production macros on one tenant hit 29 times — the author
// had written valid mermaid the bundled runtime was simply too old to know.
describe('diagram types added in mermaid 11.13', () => {
  it('accepts a venn-beta diagram', async () => {
    const dsl = [
      'venn-beta',
      '  set A["Coffee"]',
      '  set B["Tea"]',
      '  union A, B',
    ].join('\n');

    const result = await validateMermaidSyntax(dsl);

    expect(result.error).toBeNull();
    expect(result.valid).toBe(true);
  });

  it('accepts an ishikawa-beta diagram', async () => {
    const dsl = [
      'ishikawa-beta',
      '  Deploy failed',
      '    Tooling',
      '      Stale cache',
      '    Process',
      '      No rollback drill',
    ].join('\n');

    const result = await validateMermaidSyntax(dsl);

    expect(result.error).toBeNull();
    expect(result.valid).toBe(true);
  });
});
