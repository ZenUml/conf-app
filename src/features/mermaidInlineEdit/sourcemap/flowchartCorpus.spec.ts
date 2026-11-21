import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import mermaid from 'mermaid';
// Every flowchart source in Mermaid's own flowchart parser specs at the same tag
// (MIT; see the fixture's `license`). Regenerate:
// node scripts/mermaid-seq-loc/extract-corpus.mjs <version> --grammar flowchart
import corpus from './__fixtures__/upstream-flowchart-corpus.11.17.2.json';
import { getFlowchartSourceMap } from './getFlowchartSourceMap';
import { expectFlowMap } from './flowchartSourceMapInvariants';

/** Whether this source must get a map: Mermaid parses it as a flowchart with HTML labels and without ELK. */
const mustMapCache = new Map<string, Promise<boolean>>();
function mustMap(code: string): Promise<boolean> {
  let answer = mustMapCache.get(code);
  if (!answer) mustMapCache.set(code, (answer = officialMustMap(code)));
  return answer;
}

async function officialMustMap(code: string): Promise<boolean> {
  const { loadMermaid } = await import('@/utils/mermaid/loadMermaid');
  await loadMermaid();
  try {
    // getDiagramFromText runs the same parse as mermaid.parse and throws on the same errors.
    const diagram: any = await mermaid.mermaidAPI.getDiagramFromText(code);
    const config: any = mermaid.mermaidAPI.getConfig();
    if (!['flowchart-v2', 'flowchart'].includes(diagram.type)) return false;
    if (String(config.layout ?? '').startsWith('elk') || config.flowchart?.defaultRenderer === 'elk') return false;
    return config.htmlLabels !== false && config.flowchart?.htmlLabels !== false;
  } catch {
    return false;
  }
}

describe('getFlowchartSourceMap on the upstream flowchart corpus', () => {
  it('has the extracted sources', () => {
    expect(corpus.sources.length).toBeGreaterThan(150);
  });

  it('maps every source Mermaid parses as a supported flowchart', async () => {
    let mapped = 0;
    for (const source of corpus.sources) if (await mustMap(source)) mapped++;
    // A parser that returns null for everything must fail here, not pass.
    expect(mapped).toBeGreaterThan(150);
  });

  it.each(corpus.sources.map((source, i) => [i, source] as const))('source %i', async (_i, source) => {
    if (await mustMap(source)) await expectFlowMap(source);
    else expect(await getFlowchartSourceMap(source)).toBeNull();
  });
});

/** Rewrites that Mermaid's preprocessing removes again: they stress the offset map only. */
const variants: Record<string, (source: string) => string> = {
  crlf: (s) => s.replace(/\n/g, '\r\n'),
  // Not inside a multi-line quoted label: there Mermaid removes the comment
  // from the label text too, and the map is null by design (the label slice
  // no longer reproduces the db text).
  'comment lines': (s) => {
    let quotes = 0;
    return s
      .split('\n')
      .map((line) => {
        quotes += (line.match(/"/g) ?? []).length;
        return quotes % 2 === 0 ? `${line}\n%% a comment line` : line;
      })
      .join('\n');
  },
  'frontmatter and directive': (s) =>
    '---\ntitle: Variant\nconfig:\n  theme: forest\n---\n%%{init: {\n  "flowchart": { "curve": "basis" }\n}}%%\n' + s,
  'trailing whitespace': (s) => s.split('\n').join('  \t\n'),
};

describe.each(Object.entries(variants))('getFlowchartSourceMap on the corpus, %s variant', (_name, rewrite) => {
  it.each(corpus.sources.map((source, i) => [i, rewrite(source)] as const))('source %i', async (_i, source) => {
    if (await mustMap(source)) await expectFlowMap(source);
    else expect(await getFlowchartSourceMap(source)).toBeNull();
  });
});
