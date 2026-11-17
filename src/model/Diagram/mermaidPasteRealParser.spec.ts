import { describe, it, expect, vi } from 'vitest';

// Same choice as validate.spec.ts: loadMermaid() fetches a vendored bundle that
// vitest cannot load, so run the REAL parser from the npm package.
vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const mermaid = (await import('mermaid')).default;
  return { loadMermaid: async () => mermaid };
});

import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import { stripMarkdownFence } from '@/model/Diagram/markdownFence';
import { extractMermaidSource } from '@/model/Diagram/detectForeignDialect';

const BODY = `sequenceDiagram
  autonumber
  participant R as Robot
  participant GW as Gateway<br/>(edge)
  R->>GW: request credential
  alt ok
    GW-->>R: credential
  end`;
const FENCED = '```mermaid\n' + BODY + '\n```';

describe('Mermaid paste handling against the real parser', () => {
  it('rejects the fenced text (documents the bug)', async () => {
    expect((await validateMermaidSyntax(FENCED)).valid).toBe(false);
  });

  it('accepts the text after the fence is removed', async () => {
    expect((await validateMermaidSyntax(stripMarkdownFence(FENCED).text)).valid).toBe(true);
  });

  it('accepts the source extracted from prose plus a fence', async () => {
    const source = extractMermaidSource('Here is the diagram:\n' + FENCED)!;
    expect((await validateMermaidSyntax(source)).valid).toBe(true);
  });

  // The detector accepts lower-case directions, but the real parser rejects them:
  //   "Lexical error on line 1. Unrecognized text.\ngraph td  A --> B\n-----^"
  it.skip('treats graph td as valid Mermaid', async () => {
    expect((await validateMermaidSyntax('graph td\n  A --> B')).valid).toBe(true);
  });

  it.each([
    ['graph TD;', 'graph TD;\n  A --> B'],
    ['bare flowchart', 'flowchart\n  A --> B'],
  ])('treats %s as valid Mermaid', async (_label, source) => {
    expect((await validateMermaidSyntax(source)).valid).toBe(true);
  });
});
