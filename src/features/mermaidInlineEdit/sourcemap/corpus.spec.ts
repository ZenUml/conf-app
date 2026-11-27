import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import mermaid from 'mermaid';
// Every sequence source in Mermaid's own sequenceDiagram.spec.js at the same tag
// (MIT; see the fixture's `license`). Regenerate: scripts/mermaid-seq-loc/extract-corpus.mjs
import corpus from './__fixtures__/upstream-sequence-corpus.11.17.2.json';
import { getSourceMap } from './getSourceMap';
import { expectMap } from './sourceMapInvariants';

async function officialParses(code: string): Promise<boolean> {
  const { loadMermaid } = await import('@/utils/mermaid/loadMermaid');
  await loadMermaid();
  try {
    await mermaid.mermaidAPI.getDiagramFromText(code);
    return true;
  } catch {
    return false;
  }
}

describe('getSourceMap on the upstream sequence corpus', () => {
  it('has the extracted sources', () => {
    expect(corpus.sources.length).toBeGreaterThan(100);
  });

  it.each(corpus.sources.map((source, i) => [i, source] as const))('source %i', async (_i, source) => {
    if (await officialParses(source)) {
      // Same record count, order and texts as the official db, and every range valid.
      await expectMap(source);
    } else {
      expect(await getSourceMap(source)).toBeNull();
    }
  });
});

/** Rewrites that Mermaid's preprocessing removes again: they stress the offset map only. */
const variants: Record<string, (source: string) => string> = {
  crlf: (s) => s.replace(/\n/g, '\r\n'),
  'comment lines': (s) => s.split('\n').join('\n%% a comment line\n'),
  'frontmatter and directive': (s) =>
    '---\ntitle: Variant\nconfig:\n  theme: forest\n---\n%%{init: {\n  "sequence": { "mirrorActors": false }\n}}%%\n' + s,
  'trailing whitespace': (s) => s.split('\n').join('  \t\n'),
};

describe.each(Object.entries(variants))('getSourceMap on the corpus, %s variant', (_name, rewrite) => {
  it.each(corpus.sources.map((source, i) => [i, rewrite(source)] as const))('source %i', async (_i, source) => {
    if (await officialParses(source)) await expectMap(source);
    else expect(await getSourceMap(source)).toBeNull();
  });
});
