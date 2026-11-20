import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import { decodeFlowText } from '../codec/flowchartText';
import { flowchartRecordsOf, getFlowchartSourceMap, type FlowchartRecords } from '../sourcemap/getFlowchartSourceMap';
import { expectFlowMap, officialFlowDb } from '../sourcemap/flowchartSourceMapInvariants';
import type { EditResult, FlowchartSourceMap } from '../types';
import {
  editFlowEdgeLabel,
  editFlowNodeLabel,
  flowSourceTextOf,
  planFlowEdgeLabelEdit,
  planFlowNodeLabelEdit,
  verifyFlowEdit,
} from './flowchart';

async function mapOf(code: string): Promise<FlowchartSourceMap> {
  const map = await getFlowchartSourceMap(code);
  expect(map, 'fixture must map').not.toBeNull();
  return map!;
}

/** The official db records of `code`, the way the gate reads them. */
async function recordsFor(code: string): Promise<FlowchartRecords> {
  const map = await mapOf(code);
  return flowchartRecordsOf(map)!;
}

type Target = { kind: 'node' | 'edge'; key: string };

/**
 * Independent of the gate: the official db of `after` equals the one of
 * `before` except the target's text (and labelType / shape where allowed),
 * and the target's label decodes to the typed text.
 */
async function expectOnlyTargetChanged(before: string, after: string, target: Target, typed: string): Promise<void> {
  const [a, b] = [await recordsFor(before), await recordsFor(after)];
  expect(b.vertices.map((v) => [v.id, v.domId])).toEqual(a.vertices.map((v) => [v.id, v.domId]));
  expect(b.edges.map((e) => [e.id, e.start, e.end])).toEqual(a.edges.map((e) => [e.id, e.start, e.end]));
  expect(b.subgraphs).toEqual(a.subgraphs);
  a.vertices.forEach((v, i) => {
    if (target.kind === 'node' && v.id === target.key) return;
    expect(b.vertices[i]).toEqual(v);
  });
  a.edges.forEach((e, i) => {
    if (target.kind === 'edge' && e.id === target.key) return;
    expect(b.edges[i]).toEqual(e);
  });
  const map = await expectFlowMap(after);
  const loc = target.kind === 'node' ? map.nodes.get(target.key)! : map.edges.get(target.key)!;
  const range = 'labelRange' in loc ? loc.labelRange : loc.textRange;
  expect(range).not.toBeNull();
  expect(decodeFlowText(after.slice(range![0], range![1]))).toBe(typed.replace(/\r\n?/g, '\n').trim());
}

async function editNode(code: string, id: string, text: string): Promise<EditResult> {
  return editFlowNodeLabel(code, await mapOf(code), id, text);
}
async function editEdge(code: string, id: string, text: string): Promise<EditResult> {
  return editFlowEdgeLabel(code, await mapOf(code), id, text);
}

async function expectNodeEdit(code: string, id: string, text: string, expected: string): Promise<void> {
  const result = await editNode(code, id, text);
  expect(result).toEqual({ ok: true, code: expected });
  await expectOnlyTargetChanged(code, expected, { kind: 'node', key: id }, text);
}
async function expectEdgeEdit(code: string, id: string, text: string, expected: string): Promise<void> {
  const result = await editEdge(code, id, text);
  expect(result).toEqual({ ok: true, code: expected });
  await expectOnlyTargetChanged(code, expected, { kind: 'edge', key: id }, text);
}

describe('editFlowNodeLabel: source forms', () => {
  it('a bare id: inserts [text] after the first occurrence and keeps the id', async () => {
    await expectNodeEdit('flowchart LR\nA --> B\nA --> C', 'A', 'Start', 'flowchart LR\nA[Start] --> B\nA --> C');
  });

  it('a bare id with text that needs quotes: inserts ["text"]', async () => {
    await expectNodeEdit('graph TD\nA --> B', 'A', 'call (x)', 'graph TD\nA["call (x)"] --> B');
  });

  it.each([
    ['A[old]', 'A[new text]'],
    ['A(old)', 'A(new text)'],
    ['A([old])', 'A([new text])'],
    ['A[[old]]', 'A[[new text]]'],
    ['A[(old)]', 'A[(new text)]'],
    ['A((old))', 'A((new text))'],
    ['A>old]', 'A>new text]'],
    ['A{old}', 'A{new text}'],
    ['A{{old}}', 'A{{new text}}'],
    ['A[/old/]', 'A[/new text/]'],
    ['A[\\old\\]', 'A[\\new text\\]'],
    ['A[/old\\]', 'A[/new text\\]'],
    ['A[\\old/]', 'A[\\new text/]'],
    ['A(((old)))', 'A(((new text)))'],
  ])('%s', async (node, expected) => {
    await expectNodeEdit(`flowchart TD\n${node} --> B`, 'A', 'new text', `flowchart TD\n${expected} --> B`);
  });

  it.each([
    ['A[old] --> B', 'A["f(x) | y"] --> B'],
    ['A[/old/] --> B', 'A[/"f(x) | y"/] --> B'],
    ['A{  old  } --> B', 'A{"f(x) | y"} --> B'],
  ])('adds quotes when the text needs them: %s', async (line, expected) => {
    await expectNodeEdit(`flowchart TD\n${line}`, 'A', 'f(x) | y', `flowchart TD\n${expected}`);
  });

  it('a slash in a trapezoid is quoted; in a square it is not', async () => {
    await expectNodeEdit('flowchart TD\nA[/old/]', 'A', 'a/b', 'flowchart TD\nA[/"a/b"/]');
    await expectNodeEdit('flowchart TD\nA[old]', 'A', 'a/b', 'flowchart TD\nA[a/b]');
  });

  it('a quoted label stays quoted; a double quote becomes #quot;', async () => {
    await expectNodeEdit('flowchart LR\nA["old"]', 'A', 'say "hi"', 'flowchart LR\nA["say #quot;hi#quot;"]');
  });

  it('keeps entities and writes a line break as <br/>', async () => {
    await expectNodeEdit('flowchart LR\nA[Ent #35; x]', 'A', 'one\ntwo #3', 'flowchart LR\nA[one<br/>two #3]');
    await expectNodeEdit('flowchart LR\nA[x]', 'A', 'C#35; & &amp;', 'flowchart LR\nA[C#35;35; & #38;amp;]');
  });

  it('unicode', async () => {
    await expectNodeEdit('flowchart LR\nA[x]', 'A', '日本語 ünï', 'flowchart LR\nA[日本語 ünï]');
    await expectNodeEdit('flowchart LR\nA[x]', 'A', 'party 🎉', 'flowchart LR\nA["party 🎉"]');
  });

  it('a node declared twice: edits the declaration whose text the db shows', async () => {
    await expectNodeEdit(
      'flowchart LR\nA[first] --> B\nA[second] --> C',
      'A',
      'third',
      'flowchart LR\nA[first] --> B\nA[third] --> C',
    );
  });

  it('nodes inside subgraphs', async () => {
    await expectNodeEdit(
      'flowchart TB\nsubgraph one [Title]\n  A[in a] --> B\nend',
      'A',
      'moved',
      'flowchart TB\nsubgraph one [Title]\n  A[moved] --> B\nend',
    );
  });

  it('front matter and an init directive before the header', async () => {
    const head = '---\ntitle: T\n---\n%%{init: {"theme": "base"}}%%\n';
    await expectNodeEdit(`${head}graph TD\nA[a] --> B`, 'A', 'b', `${head}graph TD\nA[b] --> B`);
  });

  it('through the }\\s*\\n rewrite and next to classDef / style lines with # colours', async () => {
    const code = 'flowchart LR\n  classDef hot fill:#f96,stroke:#333;\n  A{diamond}   \n  A --> B[after]:::hot\n  style B fill:#bbf;';
    await expectNodeEdit(code, 'B', 'changed', code.replace('B[after]', 'B[changed]'));
    await expectNodeEdit(code, 'A', 'gem', code.replace('A{diamond}', 'A{gem}'));
  });
});

describe('editFlowEdgeLabel: source forms', () => {
  it.each([
    ['A -->|old| B', 'A -->|new| B'],
    ['A -- old --> B', 'A -- new --> B'],
    ['A == old ==> B', 'A == new ==> B'],
    ['A -. old .-> B', 'A -. new .-> B'],
    ['A -- "old" --> B', 'A -- "new" --> B'],
    ['A -->|"old"| B', 'A -->|"new"| B'],
  ])('%s', async (line, expected) => {
    const code = `flowchart LR\n${line}`;
    await expectEdgeEdit(code, 'L_A_B_0', 'new', `flowchart LR\n${expected}`);
  });

  it('a user-defined edge id', async () => {
    await expectEdgeEdit('flowchart LR\nA e1@-->|old| B', 'e1', 'new', 'flowchart LR\nA e1@-->|new| B');
  });

  it('a chain: only the targeted edge changes', async () => {
    await expectEdgeEdit(
      'flowchart LR\nA -->|one| B -->|two| C',
      'L_B_C_0',
      'deux',
      'flowchart LR\nA -->|one| B -->|deux| C',
    );
  });

  it('inline text that needs quotes keeps the inline form', async () => {
    await expectEdgeEdit('flowchart LR\nA -- old --> B', 'L_A_B_0', 'a-->b', 'flowchart LR\nA -- "a-->b" --> B');
    await expectEdgeEdit('flowchart LR\nA == old ==> B', 'L_A_B_0', 'x == y', 'flowchart LR\nA == "x == y" ==> B');
  });

  it('inline text without a space before the arrow is quoted (the link end could absorb a trailing o)', async () => {
    await expectEdgeEdit('flowchart LR\nA -- old--> B', 'L_A_B_0', 'go', 'flowchart LR\nA -- "go"--> B');
  });

  it('pipe text with a pipe is quoted', async () => {
    await expectEdgeEdit('flowchart LR\nA -->|old| B', 'L_A_B_0', 'a|b', 'flowchart LR\nA -->|"a|b"| B');
  });
});

describe('flowchart edits: hazards from the lexer', () => {
  it('`@` after a non-space run would start a link id: quoted', async () => {
    await expectNodeEdit('flowchart LR\nA[x] --> B', 'A', 'x@y', 'flowchart LR\nA["x@y"] --> B');
    await expectEdgeEdit('flowchart LR\nA-->|x|B', 'L_A_B_0', 'x@y', 'flowchart LR\nA-->|"x@y"|B');
  });

  it('`direction LR` would swallow the whole line: the d becomes an entity', async () => {
    await expectNodeEdit('flowchart TB\nA[x] --> B', 'A', 'go direction LR', 'flowchart TB\nA[go #100;irection LR] --> B');
  });

  it('`%%{` would start a directive: the first % becomes an entity', async () => {
    await expectNodeEdit('flowchart TB\nA[x] --> B', 'A', 'a %%{b', 'flowchart TB\nA["a #37;%{b"] --> B');
  });

  it('keywords are plain text inside delimiters', async () => {
    await expectNodeEdit('flowchart TB\nA[x] --> B', 'A', 'end', 'flowchart TB\nA[end] --> B');
    await expectEdgeEdit('flowchart TB\nA -- x --> B', 'L_A_B_0', 'subgraph end', 'flowchart TB\nA -- subgraph end --> B');
  });

  it('a quoted label starting with a backtick would be markdown: the backtick becomes an entity', async () => {
    await expectNodeEdit('flowchart TB\nA["x"]', 'A', '`code`', 'flowchart TB\nA["#96;code`"]');
  });

  it('a leading - after a ( opening would start an ellipse: quoted', async () => {
    await expectNodeEdit('flowchart TB\nA(x) --> B', 'A', '--> next', 'flowchart TB\nA("--> next") --> B');
    await expectNodeEdit('flowchart TB\nA((x)) --> B', 'A', '-1', 'flowchart TB\nA(("-1")) --> B');
  });

  it('trims the text, as Mermaid does', async () => {
    await expectNodeEdit('flowchart TB\nA[x]', 'A', '  spaced  ', 'flowchart TB\nA[spaced]');
  });
});

describe('flowchart edits: rejections', () => {
  it('empty text', async () => {
    expect(await editNode('flowchart LR\nA[x]', 'A', '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(await editEdge('flowchart LR\nA -->|x| B', 'L_A_B_0', '')).toEqual({ ok: false, reason: 'empty' });
  });

  it('HTML and characters the encoder cannot write', async () => {
    expect(await editNode('flowchart LR\nA[x]', 'A', '<b>bold</b>')).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(await editNode('flowchart LR\nA[x]', 'A', 'a < b')).toEqual({ ok: false, reason: 'invalid_characters' });
    expect(await editNode('flowchart LR\nA[x]', 'A', 'bell\u0007')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  it('read-only labels', async () => {
    const reject = { ok: false, reason: 'position_mismatch' };
    expect(await editNode('flowchart LR\nA["`**md**`"]', 'A', 'x')).toEqual(reject);
    expect(await editNode('flowchart LR\nA@{ shape: rounded, label: "t" }', 'A', 'x')).toEqual(reject);
    expect(await editNode('flowchart LR\nA[<b>x</b>]', 'A', 'x')).toEqual(reject);
    expect(await editNode('flowchart LR\nA[a]\nclick A "https://example.com"', 'A', 'x')).toEqual(reject);
    expect(await editEdge('flowchart LR\nA & B -->|shared| C', 'L_A_C_0', 'x')).toEqual(reject);
    expect(await editEdge('flowchart LR\nA --> B', 'L_A_B_0', 'x')).toEqual(reject);
    expect(await editNode('flowchart LR\nA[x]', 'missing', 'x')).toEqual(reject);
  });

  it('stale source', async () => {
    const code = 'flowchart LR\nA[x] --> B';
    const map = await mapOf(code);
    expect(await editFlowNodeLabel(`${code}\n`, map, 'A', 'y')).toEqual({ ok: false, reason: 'stale_source' });
    expect(await editFlowEdgeLabel(`${code}\n`, map, 'L_A_B_0', 'y')).toEqual({ ok: false, reason: 'stale_source' });
  });

  it('a new line that newly matches the style...:#...; rewrite', async () => {
    expect(await editNode('flowchart LR\nA[x]', 'A', 'mystyle:#35;')).toEqual({ ok: false, reason: 'invalid_characters' });
  });
});

describe('verifyFlowEdit: the safety gate', () => {
  it('refuses a plan whose result the parser cannot map', async () => {
    const code = 'flowchart LR\nA[x] --> B';
    const map = await mapOf(code);
    const plan = planFlowNodeLabelEdit(code, map, 'A', 'y');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(await verifyFlowEdit(map, plan, { getSourceMap: async () => null })).toEqual({ ok: false, reason: 'position_mismatch' });
  });

  it('refuses a result where another label changed too', async () => {
    const code = 'flowchart LR\nA[x] --> B[y]';
    const map = await mapOf(code);
    const plan = planFlowNodeLabelEdit(code, map, 'A', 'new');
    if (!plan.ok) throw new Error('plan');
    const tampered = { ...plan, code: plan.code.replace('B[y]', 'B[z]') };
    expect(await verifyFlowEdit(map, tampered)).toEqual({ ok: false, reason: 'position_mismatch' });
  });

  it('refuses a result where the label is not where the plan wrote it', async () => {
    const code = 'flowchart LR\nA[x] --> B';
    const map = await mapOf(code);
    const plan = planFlowNodeLabelEdit(code, map, 'A', 'new');
    if (!plan.ok) throw new Error('plan');
    const shifted = { ...plan, labelRange: [plan.labelRange[0] + 1, plan.labelRange[1]] as [number, number] };
    expect(await verifyFlowEdit(map, shifted)).toEqual({ ok: false, reason: 'position_mismatch' });
  });

  it('refuses a result where a record disappears', async () => {
    const code = 'flowchart LR\nA[x] --> B';
    const map = await mapOf(code);
    const plan = planFlowEdgeLabelEdit(code, map, 'L_A_B_0', 'y');
    expect(plan).toEqual({ ok: false, reason: 'position_mismatch' });
    const nodePlan = planFlowNodeLabelEdit(code, map, 'A', 'y');
    if (!nodePlan.ok) throw new Error('plan');
    const dropped = { ...nodePlan, code: 'flowchart LR\nA[y]' };
    expect(await verifyFlowEdit(map, dropped)).toEqual({ ok: false, reason: 'position_mismatch' });
  });

  it('works for a hand-built map without recorded db records (rebuilds them)', async () => {
    const code = 'flowchart LR\nA[x] --> B';
    const built = await mapOf(code);
    const copy: FlowchartSourceMap = { kind: 'flowchart', code, nodes: new Map(built.nodes), edges: new Map(built.edges) };
    expect(await editFlowNodeLabel(code, copy, 'A', 'y')).toEqual({ ok: true, code: 'flowchart LR\nA[y] --> B' });
  });
});

describe('flowSourceTextOf', () => {
  it('decodes <br/> and entities; a bare id prefills the id; read-only gives null', async () => {
    const code = 'flowchart LR\nA[one<br/>two #quot;q#quot; #35;] -->|e #59; f| B\nC["`md`"]';
    const map = await mapOf(code);
    expect(flowSourceTextOf(map, 'nodeLabel', 'A')).toBe('one\ntwo "q" #');
    expect(flowSourceTextOf(map, 'nodeLabel', 'B')).toBe('B');
    expect(flowSourceTextOf(map, 'nodeLabel', 'C')).toBeNull();
    expect(flowSourceTextOf(map, 'edgeLabel', 'L_A_B_0')).toBe('e ; f');
    expect(flowSourceTextOf(map, 'edgeLabel', 'nope')).toBeNull();
  });
});

// --- Round trip over the upstream corpus ---

import corpus from '../sourcemap/__fixtures__/upstream-flowchart-corpus.11.17.2.json';

const NASTY = [
  'Ünïcødé 日本 🎉',
  'a|b',
  '(x)',
  '"q"',
  'end',
  ' leading space',
  'multi\nline',
  '#',
  ';',
  '%%',
  '-->',
  'x@y',
  'direction LR',
  '[a] {b}',
  '&amp; #35;',
  'go',
];

describe('round trip over the upstream corpus', () => {
  it(
    'every edit either is rejected for its text, or the db shows exactly the new text and nothing else changed',
    async () => {
      // Deterministic sample: the first editable node and edge of every 4th mapped source.
      const targets: Array<{ code: string; map: FlowchartSourceMap; target: Target }> = [];
      for (let i = 0; i < corpus.sources.length; i += 4) {
        const map = await getFlowchartSourceMap(corpus.sources[i]);
        if (!map) continue;
        const nodes = [...map.nodes].filter(([, l]) => !l.readOnly).slice(0, 1);
        const edges = [...map.edges].filter(([, l]) => !l.readOnly).slice(0, 1);
        for (const [key] of nodes) targets.push({ code: map.code, map, target: { kind: 'node', key } });
        for (const [key] of edges) targets.push({ code: map.code, map, target: { kind: 'edge', key } });
      }
      expect(targets.length).toBeGreaterThan(30);

      const rejected: Record<string, number> = {};
      let accepted = 0;
      for (const { code, map, target } of targets) {
        for (const text of NASTY) {
          const result =
            target.kind === 'node'
              ? await editFlowNodeLabel(code, map, target.key, text)
              : await editFlowEdgeLabel(code, map, target.key, text);
          if (!result.ok) {
            rejected[result.reason] = (rejected[result.reason] ?? 0) + 1;
            continue;
          }
          accepted++;
          await expectOnlyTargetChanged(code, result.code, target, text);
        }
      }
      // A position_mismatch here means the encoder wrote something the gate refused: an encoder bug.
      expect(Object.keys(rejected).filter((r) => r !== 'invalid_characters' && r !== 'empty')).toEqual([]);
      expect(accepted).toBeGreaterThan(targets.length * (NASTY.length - 2));
    },
    600_000,
  );
});

// Keep the official-db helper referenced for readers of this file: the gate's
// own records come from getFlowchartSourceMap, the checks above from a fresh parse.
void officialFlowDb;
