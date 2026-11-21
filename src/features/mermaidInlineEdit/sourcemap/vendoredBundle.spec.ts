import { expect, it, vi } from 'vitest';

// The browser loads node_modules/mermaid/dist/mermaid.esm.min.mjs (copied to
// dist/vendor/mermaid by vite.config.mjs), not the unminified npm entry the
// other specs use. The subclass reaches into SequenceDB (`state.records`,
// `getActorKeys`), so check the minified build too.
vi.mock('@/utils/mermaid/loadMermaid', async () => {
  // @ts-expect-error the minified bundle ships without its own type declarations
  const mod: any = await import('mermaid/dist/mermaid.esm.min.mjs');
  const m = mod.default ?? mod;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import flowchartCorpus from './__fixtures__/upstream-flowchart-corpus.11.17.2.json';
import corpus from './__fixtures__/upstream-sequence-corpus.11.17.2.json';
import { getFlowchartSourceMap } from './getFlowchartSourceMap';
import { getSourceMap } from './getSourceMap';

it('maps the upstream corpus with the minified vendored mermaid bundle', async () => {
  const reasons: string[] = [];
  let mapped = 0;
  for (const source of corpus.sources) {
    if (await getSourceMap(source, { onReject: (r) => reasons.push(r) })) mapped++;
  }
  // The only rejections are sources Mermaid itself does not parse.
  expect(new Set(reasons)).toEqual(new Set(['Mermaid does not parse the source']));
  expect(mapped).toBe(corpus.sources.length - reasons.length);
  expect(mapped).toBeGreaterThan(100);
});

it('maps the upstream flowchart corpus with the minified vendored mermaid bundle', async () => {
  // The FlowDB subclass overrides addVertex, addSingleLink, setClickEvent and
  // setLink, and reads `vertices` / `edges`: check the minified build too.
  const reasons: string[] = [];
  let mapped = 0;
  for (const source of flowchartCorpus.sources) {
    if (await getFlowchartSourceMap(source, { onReject: (r) => reasons.push(r) })) mapped++;
  }
  // Only "not supported" rejections; never a disagreement with the official db.
  const allowed = new Set(['Mermaid does not parse the source', 'not a flowchart', 'ELK layout', 'htmlLabels is false']);
  expect([...new Set(reasons)].filter((r) => !allowed.has(r))).toEqual([]);
  expect(mapped).toBe(flowchartCorpus.sources.length - reasons.length);
  expect(mapped).toBeGreaterThan(150);
});
