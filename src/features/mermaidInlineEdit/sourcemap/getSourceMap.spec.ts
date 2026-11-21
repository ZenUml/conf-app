import { describe, expect, it, vi } from 'vitest';
import type { SequenceSourceMap } from '../types';

// loadMermaid() imports the vendored bundle by URL, which vitest cannot load.
// Use the npm package: the same version the vendored copy is built from.
vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  // loadMermaid() initializes once; getDiagramFromText needs the registered diagrams.
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import { getSourceMap } from './index';
import { __locParserImport, __resetLocParserForTests } from './getSourceMap';
import { expectMap, slice } from './sourceMapInvariants';

const lines = (...l: string[]) => l.join('\n');
const texts = (code: string, map: SequenceSourceMap) =>
  [...map.messages.values()].map(({ textRange }) => slice(code, textRange!));

describe('getSourceMap: messages', () => {
  it('covers each message text exactly, keyed by db index', async () => {
    const code = lines('sequenceDiagram', 'Alice->>Bob: Hello Bob', 'Bob-->>Alice:   Hi   ', 'Alice-xBob:x');
    const map = await expectMap(code);
    expect([...map.messages.keys()]).toEqual([0, 1, 2]);
    expect(texts(code, map)).toEqual(['Hello Bob', 'Hi', 'x']);
  });

  it('gives identical messages different ranges', async () => {
    const code = lines('sequenceDiagram', 'A->>B: same', 'A->>B: same');
    const map = await expectMap(code);
    const [r0, r1] = [map.messages.get(0)!.textRange!, map.messages.get(1)!.textRange!];
    expect(r0).not.toEqual(r1);
    expect(r1[0]).toBeGreaterThan(r0[1]);
  });

  it('excludes a wrap: / nowrap: prefix', async () => {
    const code = lines('sequenceDiagram', 'A->>B: wrap: long text', 'A->>B:nowrap:  short ', 'A->>B:wrap:');
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['long text', 'short', '']);
    const empty = map.messages.get(2)!.textRange!;
    expect(code.slice(0, empty[0]).endsWith(':wrap:')).toBe(true);
  });

  it('gives an empty text an empty range right after the colon', async () => {
    const code = lines('sequenceDiagram', 'A->>B:', 'A->>B:   ', 'A->>B: x');
    const map = await expectMap(code);
    for (const i of [0, 1]) {
      const [s, e] = map.messages.get(i)!.textRange!;
      expect(s).toBe(e);
      expect(code[s - 1]).toBe(':');
    }
  });

  it('keeps <br>, HTML entities and markup in the range', async () => {
    const code = lines('sequenceDiagram', 'A->>B: line1<br>line2', 'A->>B: I #9829; you #35;1', 'A->>B: <b class="x">bold</b>');
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['line1<br>line2', 'I #9829; you #35;1', '<b class="x">bold</b>']);
  });

  it('maps every arrow type and the () central connection', async () => {
    const arrows = ['->', '-->', '->>', '-->>', '<<->>', '<<-->>', '-x', '--x', '-)', '--)'];
    const code = lines('sequenceDiagram', ...arrows.map((a, i) => `A${a}B: m${i}`), 'A->>()B: c1', 'A()->>B: c2');
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual([...arrows.map((_, i) => `m${i}`), 'c1', 'c2']);
  });

  it('keys messages past activation, autonumber and block records', async () => {
    const code = lines(
      'sequenceDiagram',
      'autonumber',
      'A->>+B: one',
      'B-->>-A: two',
      'loop every minute',
      '  A->>B: three',
      'end',
      'alt ok',
      '  A->>B: four',
      'else not ok',
      '  A->>B: five',
      'end',
      'opt maybe',
      '  A->>B: six',
      'end',
      'par first',
      '  A->>B: seven',
      'and second',
      '  A->>C: eight',
      'end',
      'critical c',
      '  A->>B: nine',
      'option o',
      '  A->>B: ten',
      'end',
      'break b',
      '  A->>B: eleven',
      'end',
      'rect rgb(0, 0, 255)',
      '  A->>B: twelve',
      'end',
    );
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(
      ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
    );
    // Record 0 is autonumber, 1 the first message: the keys are db indexes, not ordinals.
    expect(map.messages.has(0)).toBe(false);
    expect(map.messages.has(1)).toBe(true);
  });
});

describe('getSourceMap: notes', () => {
  it('maps notes over, left of and right of', async () => {
    const code = lines(
      'sequenceDiagram',
      'A->>B: hi',
      'Note over A,B: spans both',
      'Note left of A: left',
      'note right of B : right ',
      'Note over B:',
    );
    const map = await expectMap(code);
    expect([...map.notes.values()].map(({ textRange }) => slice(code, textRange!))).toEqual([
      'spans both',
      'left',
      'right',
      '',
    ]);
    expect(map.participants.get('A')!.idRanges).toHaveLength(3);
    expect(map.participants.get('B')!.idRanges).toHaveLength(4);
  });
});

describe('getSourceMap: participants', () => {
  it('finds every id occurrence and the alias label', async () => {
    const code = lines(
      'sequenceDiagram',
      'participant A as Alice  ',
      'actor B as Bob the builder',
      'A->>+B: hi',
      'activate A',
      'B-->>-A: back',
      'deactivate A',
      'links A: {"Repo": "https://example.com"}',
      'link B: Dashboard @ https://example.com',
      'properties A: {"class": "x"}',
    );
    const map = await expectMap(code);
    const a = map.participants.get('A')!;
    expect(a.hasAlias).toBe(true);
    expect(a.labelRanges.map((r) => slice(code, r))).toEqual(['Alice']);
    expect(a.idRanges).toHaveLength(7);
    const b = map.participants.get('B')!;
    expect(b.labelRanges.map((r) => slice(code, r))).toEqual(['Bob the builder']);
    expect(b.idRanges).toHaveLength(4);
  });

  it('treats an id with spaces as one id, as Mermaid does', async () => {
    const code = lines('sequenceDiagram', 'participant Big Alice', 'Big Alice ->> Bob Smith : hi', 'participant Big Carl as Carl');
    const map = await expectMap(code);
    expect(map.participants.get('Big Alice')!.idRanges).toHaveLength(2);
    expect(map.participants.get('Bob Smith')!.idRanges).toHaveLength(1);
    // 11.17.2 has no alias for an id with spaces: the whole rest is the id.
    expect(map.participants.has('Big Carl as Carl')).toBe(true);
  });

  it('keeps quotes that are part of an id', async () => {
    const code = lines('sequenceDiagram', 'participant "Quoted" as Q', '"Quoted"->>B: hi');
    const map = await expectMap(code);
    expect(map.participants.get('"Quoted"')!.idRanges).toHaveLength(2);
  });

  it('handles implicit participants', async () => {
    const code = lines('sequenceDiagram', 'Client->>Server: req', 'Server-->>Client: res');
    const map = await expectMap(code);
    expect([...map.participants.keys()]).toEqual(['Client', 'Server']);
    expect(map.participants.get('Client')!.hasAlias).toBe(false);
    expect(map.participants.get('Client')!.idRanges).toHaveLength(2);
  });

  it('handles create and destroy', async () => {
    const code = lines(
      'sequenceDiagram',
      'A->>B: hello',
      'create participant C as Carl',
      'B->>C: make',
      'destroy C',
      'C->>B: bye',
    );
    const map = await expectMap(code);
    expect(map.participants.get('C')!.idRanges).toHaveLength(4);
    expect(map.participants.get('C')!.labelRanges.map((r) => slice(code, r))).toEqual(['Carl']);
  });

  it('handles box members', async () => {
    const code = lines(
      'sequenceDiagram',
      'box Aqua Group one',
      '  participant A',
      '  participant B as Bee',
      'end',
      'box rgb(10,20,30)',
      'participant C',
      'end',
      'A->>C: hi',
    );
    const map = await expectMap(code);
    expect(map.participants.get('A')!.idRanges).toHaveLength(2);
    expect(map.participants.get('B')!.labelRanges.map((r) => slice(code, r))).toEqual(['Bee']);
  });

  it('handles @{...} participant config', async () => {
    const code = lines(
      'sequenceDiagram',
      'participant API@{ "type": "boundary" }',
      'participant DB@{ "type": "database" } as Store',
      'participant Q@{ "type": "queue", "alias": "Jobs" }',
      'API->>DB: query',
      'API->>Q: push',
    );
    const map = await expectMap(code);
    expect(map.participants.get('API')!.hasAlias).toBe(false);
    expect(map.participants.get('DB')!.labelRanges.map((r) => slice(code, r))).toEqual(['Store']);
    // The label comes from the config; it has no editable range.
    expect(map.participants.get('Q')).toMatchObject({ hasAlias: true, labelRanges: [] });
  });

  it('uses the declaration that last set the label', async () => {
    const code = lines('sequenceDiagram', 'A->>B: hi', 'participant A as First', 'participant A as Second');
    const map = await expectMap(code);
    expect(map.participants.get('A')!.labelRanges.map((r) => slice(code, r))).toEqual(['Second']);
  });
});

describe('getSourceMap: preprocessing', () => {
  it('maps offsets past frontmatter, directives and comments', async () => {
    const code = lines(
      '---',
      'title: Demo',
      'config:',
      '  sequence:',
      '    mirrorActors: false',
      '---',
      '%%{init: { "theme": "forest" } }%%',
      '%% a comment',
      'sequenceDiagram',
      '  %% another comment',
      '  A->>B: one %% not a comment here',
      '%%{wrap}%%',
      '  B-->>A: two',
    );
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['one %% not a comment here', 'two']);
  });

  it('maps \\r\\n sources to offsets in the original string', async () => {
    const code = ['sequenceDiagram', 'participant A as Alice', 'A->>B: one', 'A->>B:', 'Note over A: n', ''].join('\r\n');
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['one', '']);
    const [s, e] = map.messages.get(1)!.textRange!;
    expect(s).toBe(e);
    expect(code[s - 1]).toBe(':');
    expect(code[s]).toBe('\r');
  });

  it('maps past an indented frontmatter, a multi-line directive and # comments', async () => {
    const code = lines(
      '  ---',
      '  title: Indented',
      '  ---',
      'sequenceDiagram',
      'A->>B: before',
      '%%{init: {',
      '  "theme": "dark"',
      '}}%%',
      'A->>B: after # trailing comment',
      'A->>B: ends with entity #35;',
    );
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['before', 'after', 'ends with entity #35;']);
  });

  it('maps a source with lone \\r line endings', async () => {
    const code = ['sequenceDiagram', 'A->>B: one', 'B->>A: two'].join('\r');
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['one', 'two']);
  });

  it('handles title, accTitle, accDescr and ; separators', async () => {
    const code = lines(
      'sequenceDiagram',
      'title My flow',
      'accTitle: t',
      'accDescr { multi',
      'line }',
      'A->>B: one; B->>A: two',
    );
    const map = await expectMap(code);
    expect(texts(code, map)).toEqual(['one', 'two']);
  });
});

describe('getSourceMap: returns null', () => {
  it.each([
    ['a flowchart', 'flowchart LR\nA-->B'],
    ['a parse error', 'sequenceDiagram\nA->>: oops ->>'],
    ['an empty string', ''],
    ['an id with an entity code', 'sequenceDiagram\nA#35;B->>C: hi'],
  ])('for %s', async (_name, code) => {
    expect(await getSourceMap(code)).toBeNull();
  });

  it('does not throw for a deactivate of an inactive participant', async () => {
    expect(await getSourceMap('sequenceDiagram\nA->>B: hi\ndeactivate A')).toBeNull();
  });
});

describe('getSourceMap: loading', () => {
  it('retries after a failed parser chunk load', async () => {
    const real = __locParserImport.load;
    __resetLocParserForTests();
    __locParserImport.load = () => Promise.reject(new Error('chunk fetch failed'));
    const reasons: string[] = [];
    const code = 'sequenceDiagram\nA->>B: hi';
    try {
      expect(await getSourceMap(code, { onReject: (r) => reasons.push(r) })).toBeNull();
    } finally {
      __locParserImport.load = real;
    }
    expect(reasons[0]).toContain('chunk fetch failed');
    expect(await getSourceMap(code)).not.toBeNull();
  });
});
