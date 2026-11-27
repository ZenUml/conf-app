import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import mermaid from 'mermaid';
import corpus from './__fixtures__/upstream-sequence-corpus.11.17.2.json';
import { getSourceMap } from './getSourceMap';

// jsdom has no layout; Mermaid only needs sizes, not real ones.
beforeAll(() => {
  const proto = (globalThis as any).SVGElement.prototype;
  proto.getBBox ??= () => ({ x: 0, y: 0, width: 50, height: 10 });
  proto.getComputedTextLength ??= () => 50;
});

let renderCount = 0;
/** data-id values of the official render, per element kind. */
async function svgKeys(code: string) {
  const { svg } = await mermaid.render(`sourcemap-keys-${renderCount++}`, code);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const ids = (kind: string) => [...doc.querySelectorAll(`[data-et="${kind}"]`)].map((e) => e.getAttribute('data-id'));
  return { participants: new Set(ids('participant')), messages: ids('message'), notes: ids('note') };
}

async function expectKeysMatchSvg(code: string) {
  const map = (await getSourceMap(code))!;
  expect(map).not.toBeNull();
  const svg = await svgKeys(code);
  expect(svg.participants).toEqual(new Set(map.participants.keys()));
  expect(svg.messages).toEqual([...map.messages.keys()].map((k) => `i${k}`));
  expect(svg.notes).toEqual([...map.notes.keys()].map((k) => `i${k}`));
}

describe('map keys are the data-id values of the official SVG', () => {
  it('for a mixed diagram', async () => {
    await expectKeysMatchSvg(
      [
        'sequenceDiagram',
        'participant A as Alice',
        'autonumber',
        'A->>+B: one',
        'loop L',
        '  B-->>-A: two',
        'end',
        'Note over A,B: n1',
        'create participant C',
        'A->>C: three',
        'destroy C',
        'C-->>A: four',
      ].join('\n'),
    );
  });

  it('for every upstream corpus source that renders in jsdom', async () => {
    let checked = 0;
    for (const source of corpus.sources) {
      let svg;
      try {
        svg = await svgKeys(source);
      } catch {
        continue; // does not parse, or needs layout jsdom lacks
      }
      const map = await getSourceMap(source);
      expect(map, source).not.toBeNull();
      expect(svg.participants, source).toEqual(new Set(map!.participants.keys()));
      expect(svg.messages, source).toEqual([...map!.messages.keys()].map((k) => `i${k}`));
      expect(svg.notes, source).toEqual([...map!.notes.keys()].map((k) => `i${k}`));
      checked++;
    }
    expect(checked).toBeGreaterThan(80);
  });
});
