import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import type { FlowchartSourceMap } from '../types';
import { getDiagramSourceMap } from './index';
import { __flowLocParserImport, __resetFlowLocParserForTests, getFlowchartSourceMap } from './getFlowchartSourceMap';
import { expectFlowMap, slice } from './flowchartSourceMapInvariants';

const nodeLabel = (map: FlowchartSourceMap, id: string) => {
  const loc = map.nodes.get(id)!;
  return loc.labelRange ? slice(map.code, loc.labelRange) : null;
};
const edgeLabels = (map: FlowchartSourceMap) =>
  [...map.edges.values()].map((e) => (e.textRange ? slice(map.code, e.textRange) : null));

describe('getFlowchartSourceMap: node shapes', () => {
  it.each([
    ['square', 'A[t one]'],
    ['round', 'A(t one)'],
    ['stadium', 'A([t one])'],
    ['subroutine', 'A[[t one]]'],
    ['cylinder', 'A[(t one)]'],
    ['circle', 'A((t one))'],
    ['odd', 'A>t one]'],
    ['diamond', 'A{t one}'],
    ['hexagon', 'A{{t one}}'],
    ['lean_right', 'A[/t one/]'],
    ['lean_left', 'A[\\t one\\]'],
    ['trapezoid', 'A[/t one\\]'],
    ['inv_trapezoid', 'A[\\t one/]'],
    ['doublecircle', 'A(((t one)))'],
  ])('%s: %s', async (shape, node) => {
    const map = await expectFlowMap(`flowchart TD\n  ${node} --> B`);
    const loc = map.nodes.get('A')!;
    expect(loc.shape).toBe(shape);
    expect(nodeLabel(map, 'A')).toBe('t one');
    expect(loc).toMatchObject({ quoted: false, insertAt: null, readOnly: null });
  });

  it('trims the whitespace inside the brackets, and the inner range keeps it', async () => {
    const code = 'graph TD\nA[  padded  ]';
    const map = await expectFlowMap(code);
    expect(nodeLabel(map, 'A')).toBe('padded');
    expect(slice(code, map.nodes.get('A')!.innerRange!)).toBe('  padded  ');
  });
});

describe('getFlowchartSourceMap: text forms', () => {
  it('a bare id shows the id: no label range, insertAt after the first occurrence', async () => {
    const code = 'flowchart LR\n  A --> B\n  A --> C[c]';
    const map = await expectFlowMap(code);
    const a = map.nodes.get('A')!;
    expect(a.labelRange).toBeNull();
    expect(a.insertAt).toBe(code.indexOf('A') + 1);
    expect(a.readOnly).toBeNull();
  });

  it('a quoted label: range inside the quotes, inner range includes them', async () => {
    const code = 'flowchart LR\nA["say (hi)"] --> B';
    const map = await expectFlowMap(code);
    const a = map.nodes.get('A')!;
    expect(nodeLabel(map, 'A')).toBe('say (hi)');
    expect(slice(code, a.innerRange!)).toBe('"say (hi)"');
    expect(a.quoted).toBe(true);
    expect(a.readOnly).toBeNull();
  });

  it('a markdown label is read-only', async () => {
    const map = await expectFlowMap('flowchart LR\nA["`**bold**`"] --> B');
    expect(map.nodes.get('A')!.readOnly).toBe('markdown');
  });

  it('shape data with a label is read-only; shape data without one is not', async () => {
    const map = await expectFlowMap('flowchart LR\nA@{ shape: rounded, label: "t" }\nB[b]@{ shape: rounded }\nA --> B');
    expect(map.nodes.get('A')!).toMatchObject({ readOnly: 'shape_data', labelRange: null });
    expect(map.nodes.get('B')!.readOnly).toBeNull();
    expect(nodeLabel(map, 'B')).toBe('b');
  });

  it('an entity code keeps its source spelling in the range', async () => {
    const map = await expectFlowMap('flowchart LR\nA[Ent #35; x] --> B[q #quot;x#quot;]');
    expect(nodeLabel(map, 'A')).toBe('Ent #35; x');
    expect(nodeLabel(map, 'B')).toBe('q #quot;x#quot;');
    expect(map.nodes.get('A')!.readOnly).toBeNull();
  });

  it('a <br/> line break is editable', async () => {
    const map = await expectFlowMap('flowchart LR\nA[one<br/>two] --> B');
    expect(nodeLabel(map, 'A')).toBe('one<br/>two');
    expect(map.nodes.get('A')!.readOnly).toBeNull();
  });

  it('other HTML and HTML entities are read-only', async () => {
    const map = await expectFlowMap('flowchart LR\nA[<b>x</b>] --> B[R &amp; D] --> C[R&D]');
    expect(map.nodes.get('A')!.readOnly).toBe('html');
    expect(map.nodes.get('B')!.readOnly).toBe('html');
    expect(map.nodes.get('C')!.readOnly).toBeNull();
  });

  it('unicode text', async () => {
    const map = await expectFlowMap('flowchart LR\nA[日本語 ünï] --> B["Ελληνικά 🎉"]');
    expect(nodeLabel(map, 'A')).toBe('日本語 ünï');
    expect(nodeLabel(map, 'B')).toBe('Ελληνικά 🎉');
  });

  it('a node declared twice: the last declaration that carries text owns the label', async () => {
    const code = 'flowchart LR\nA[first] --> B\nA --> C\nA[second] --> D\nA --> E';
    const map = await expectFlowMap(code);
    expect(map.nodes.get('A')!.labelRange).toEqual([code.indexOf('second'), code.indexOf('second') + 6]);
  });

  it('a raw line break inside a quoted label is read-only', async () => {
    const map = await expectFlowMap('flowchart LR\nA["multi\n   line"] --> B');
    expect(map.nodes.get('A')!.readOnly).toBe('unsupported');
  });

  it('a node targeted by click is read-only', async () => {
    const map = await expectFlowMap('flowchart LR\nA[a] --> B[b]\nclick A "https://example.com"\nclick B callback');
    expect(map.nodes.get('A')!.readOnly).toBe('linked_node');
    expect(map.nodes.get('B')!.readOnly).toBe('linked_node');
  });

  it('a node only named in a style line has no vertex occurrence: unsupported', async () => {
    const map = await expectFlowMap('flowchart LR\nA --> B\nstyle C fill:#f9f');
    expect(map.nodes.get('C')!).toMatchObject({ readOnly: 'unsupported', insertAt: null });
  });
});

describe('getFlowchartSourceMap: edges', () => {
  it.each([
    ['pipe', 'A -->|t one| B', 'pipe', false],
    ['inline dashes', 'A -- t one --> B', 'inline', false],
    ['thick', 'A == t one ==> B', 'inline', false],
    ['dotted', 'A -. t one .-> B', 'inline', false],
    ['inline quoted', 'A -- "t one" --> B', 'inline', true],
    ['pipe quoted', 'A -->|"t one"| B', 'pipe', true],
    ['edge id', 'A e1@-->|t one| B', 'pipe', false],
  ])('%s: %s', async (_name, line, form, quoted) => {
    const map = await expectFlowMap(`flowchart LR\n${line}`);
    const [edge] = [...map.edges.values()];
    expect(edge).toMatchObject({ form, quoted, readOnly: null });
    expect(edgeLabels(map)).toEqual(['t one']);
  });

  it('keys edges by the db id, including a user-defined one', async () => {
    const map = await expectFlowMap('flowchart LR\nA e1@-->|t| B\nA --> B');
    // Mermaid's counter for the second A->B edge is existingLinks.length + 1.
    expect([...map.edges.keys()]).toEqual(['e1', 'L_A_B_2']);
  });

  it('an edge without a label is read-only', async () => {
    const map = await expectFlowMap('flowchart LR\nA --> B');
    expect([...map.edges.values()][0]).toMatchObject({ textRange: null, readOnly: 'no_label' });
  });

  it('a chain gives one entry per edge', async () => {
    const map = await expectFlowMap('flowchart LR\nA -->|one| B -->|two| C --> D');
    expect(edgeLabels(map)).toEqual(['one', 'two', null]);
  });

  it('A & B -->|t| C: two edges share one range, both read-only', async () => {
    const map = await expectFlowMap('flowchart LR\nA & B -->|shared| C');
    const edges = [...map.edges.values()];
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.readOnly)).toEqual(['shared_edge_label', 'shared_edge_label']);
  });
});

describe('getFlowchartSourceMap: diagram forms', () => {
  it('nodes inside subgraphs; subgraph titles get no entry', async () => {
    const map = await expectFlowMap('flowchart TB\nsubgraph one [Title one]\n  A[in a] --> B\nend\nsubgraph two\n  C(in c)\nend\nB --> C');
    expect([...map.nodes.keys()]).toEqual(['A', 'B', 'C']);
    expect(nodeLabel(map, 'A')).toBe('in a');
    expect(nodeLabel(map, 'C')).toBe('in c');
  });

  it.each([
    ['graph TD', 'graph TD\nA[a] --> B'],
    ['flowchart LR', 'flowchart LR\nA[a] --> B'],
    ['front matter', '---\ntitle: T\nconfig:\n  theme: forest\n---\nflowchart LR\nA[a] --> B'],
    ['init directive', '%%{init: {"theme": "base"}}%%\nflowchart TD\nA[a] --> B'],
    ['comments and CRLF', '%% c\r\nflowchart TD\r\n%% d\r\nA[a] --> B\r\n'],
  ])('header form: %s', async (_name, code) => {
    const map = await expectFlowMap(code);
    expect(nodeLabel(map, 'A')).toBe('a');
  });

  it('maps through the `}\\s*\\n` rewrite of the flowchart parser wrapper', async () => {
    const code = 'flowchart LR\n  A{diamond}   \n  A --> B[after]   \n  B{{hex}}\t \n  B --> C[c]';
    const map = await expectFlowMap(code);
    expect(nodeLabel(map, 'B')).toBe('hex');
    expect(nodeLabel(map, 'C')).toBe('c');
  });

  it('classDef and style lines with # colours do not move the ranges', async () => {
    const code = 'flowchart LR\n  classDef hot fill:#f96,stroke:#333;\n  A[Label #35; one]:::hot --> B[after]\n  style B fill:#bbf;\n  B -->|edge #quot;q#quot;| C["s #59; t"]';
    const map = await expectFlowMap(code);
    expect(nodeLabel(map, 'A')).toBe('Label #35; one');
    expect(nodeLabel(map, 'C')).toBe('s #59; t');
    expect(edgeLabels(map)).toEqual([null, 'edge #quot;q#quot;']);
  });
});

describe('getFlowchartSourceMap: returns null', () => {
  it.each([
    ['a sequence diagram', 'sequenceDiagram\nA->>B: hi'],
    ['a parse error', 'flowchart LR\nA[unclosed --> B'],
    ['an empty string', ''],
    ['flowchart-elk', 'flowchart-elk TD\nA[a] --> B'],
    ['ELK layout in front matter', '---\nconfig:\n  layout: elk\n---\nflowchart TD\nA[a] --> B'],
    ['htmlLabels false in a directive', '%%{init: {"flowchart": {"htmlLabels": false}}}%%\nflowchart TD\nA[a] --> B'],
    ['htmlLabels false in front matter', '---\nconfig:\n  htmlLabels: false\n---\nflowchart TD\nA[a] --> B'],
  ])('for %s', async (_name, code) => {
    expect(await getFlowchartSourceMap(code)).toBeNull();
  });

  it('a label whose line Mermaid rewrites (`style...:#...;`) gives no map rather than a wrong range', async () => {
    const reasons: string[] = [];
    expect(await getFlowchartSourceMap('flowchart LR\nA[mystyle:#35; x] --> B', { onReject: (r) => reasons.push(r) })).toBeNull();
    expect(reasons).toEqual(['node label range does not reproduce the db text']);
  });
});

describe('getFlowchartSourceMap: loading', () => {
  it('retries after a failed parser chunk load', async () => {
    const real = __flowLocParserImport.load;
    __resetFlowLocParserForTests();
    __flowLocParserImport.load = () => Promise.reject(new Error('chunk fetch failed'));
    const reasons: string[] = [];
    const code = 'flowchart LR\nA --> B';
    try {
      expect(await getFlowchartSourceMap(code, { onReject: (r) => reasons.push(r) })).toBeNull();
    } finally {
      __flowLocParserImport.load = real;
    }
    expect(reasons[0]).toContain('chunk fetch failed');
    expect(await getFlowchartSourceMap(code)).not.toBeNull();
  });
});

describe('getDiagramSourceMap', () => {
  it('dispatches on the diagram type', async () => {
    expect((await getDiagramSourceMap('sequenceDiagram\nA->>B: hi'))?.kind).toBe('sequence');
    expect((await getDiagramSourceMap('%%{init: {}}%%\ngraph TD\nA --> B'))?.kind).toBe('flowchart');
    expect(await getDiagramSourceMap('classDiagram\nA <|-- B')).toBeNull();
  });
});
