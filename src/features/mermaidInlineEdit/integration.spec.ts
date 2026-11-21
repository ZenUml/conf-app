/**
 * Integration: the real position parser (sourcemap/) feeding the real edit
 * functions (edit/), checked against the official Mermaid 11.17.2 parser.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import mermaid from 'mermaid';
import type { Range, SequenceSourceMap } from './types';
import { getSourceMap } from './sourcemap';
import { editMessageText, renameParticipant, sourceTextOf } from './edit';
import { expectOnlyRangesChanged } from './edit/testHelpers';
import { encodeEntities } from './sourcemap/sourceMapInvariants';
import corpus from './sourcemap/__fixtures__/upstream-sequence-corpus.11.17.2.json';

const lines = (...l: string[]) => l.join('\n');

interface Db {
  actors: Array<[string, string]>;
  messages: Array<{ message: string; from?: string; to?: string; type?: number }>;
}

async function db(code: string): Promise<Db> {
  const diagram: any = await (mermaid as any).mermaidAPI.getDiagramFromText(code);
  return {
    actors: [...diagram.db.getActors().entries()].map(([id, a]: any) => [id, a.description] as [string, string]),
    messages: diagram.db.getMessages().map((m: any) => ({ message: m.message, from: m.from, to: m.to, type: m.type })),
  };
}

async function mapOf(code: string): Promise<SequenceSourceMap> {
  const map = await getSourceMap(code);
  expect(map, 'source map should not be null').not.toBeNull();
  return map!;
}

/** Applies the same-length-agnostic replacement to a range set, for the diff check. */
function expectedRanges(map: SequenceSourceMap, id: string, alias: boolean): Range[] {
  const loc = map.participants.get(id)!;
  return alias ? loc.labelRanges : loc.idRanges;
}

async function rename(code: string, id: string, newName: string, expectIdCount?: number) {
  const map = await mapOf(code);
  const loc = map.participants.get(id)!;
  expect(loc, `participant ${id}`).toBeDefined();
  if (expectIdCount !== undefined) expect(loc.idRanges.length).toBe(expectIdCount);
  const before = await db(code);
  const res = renameParticipant(code, map, id, newName);
  expect(res).toMatchObject({ ok: true });
  if (!res.ok) throw new Error('unreachable');
  expectOnlyRangesChanged(code, res.code, expectedRanges(map, id, loc.hasAlias), newName);
  const after = await db(res.code);
  expect(after.messages.length).toBe(before.messages.length);
  expect(after.actors.length).toBe(before.actors.length);
  expect(await getSourceMap(res.code), 'edited source still editable').not.toBeNull();
  return { map, before, after, code: res.code };
}

async function editText(code: string, index: number, text: string) {
  const map = await mapOf(code);
  const before = await db(code);
  const res = editMessageText(code, map, index, text);
  expect(res).toMatchObject({ ok: true });
  if (!res.ok) throw new Error('unreachable');
  expectOnlyRangesChanged(code, res.code, [map.messages.get(index)!.textRange!], text.trim());
  const after = await db(res.code);
  expect(after.messages.length).toBe(before.messages.length);
  expect(after.actors).toEqual(before.actors);
  // Every other message is unchanged.
  after.messages.forEach((m, i) => {
    if (i !== index) expect(m.message).toEqual(before.messages[i].message);
  });
  expect(await getSourceMap(res.code), 'edited source still editable').not.toBeNull();
  return { map, before, after, code: res.code };
}

describe('integration: renameParticipant with the real parser', () => {
  it('renames an unaliased participant everywhere it appears', async () => {
    const code = lines(
      'sequenceDiagram',
      'box Blue Team',
      'participant Alice',
      'participant Bob',
      'end',
      'Alice->>Bob: hi',
      'activate Bob',
      'Bob->>Alice: back',
      'deactivate Bob',
      'Note over Alice,Bob: shared',
      'create participant Carol',
      'Alice->>Carol: make',
      'destroy Carol',
      'Carol-->>Alice: bye',
    );
    // box member, 2 messages + activate/deactivate counted below
    const { after, map } = await rename(code, 'Alice', 'Zz9');
    // declaration, 4 message ends, note = 6
    expect(map.participants.get('Alice')!.idRanges.length).toBe(6);
    expect(after.actors.map(([id]) => id)).toContain('Zz9');
    expect(after.actors.map(([id]) => id)).not.toContain('Alice');

    // Bob: declaration, 2 ends (Alice->>Bob, Bob->>Alice), activate, deactivate, note = 6
    const bob = await rename(code, 'Bob', 'Zz9');
    expect(bob.map.participants.get('Bob')!.idRanges.length).toBe(6);

    // Carol: create participant, message end, destroy, message start
    const carol = await rename(code, 'Carol', 'Zz9');
    expect(carol.map.participants.get('Carol')!.idRanges.length).toBe(4);
    expect(carol.after.actors.map(([id]) => id)).toContain('Zz9');
  });

  it('renames an implicit participant that appears only in messages', async () => {
    const code = lines('sequenceDiagram', 'Alice->>Bob: hi', 'Bob->>Alice: yo');
    const { map, after } = await rename(code, 'Bob', 'Zz9', 2);
    expect(map.participants.get('Bob')!.hasAlias).toBe(false);
    expect(after.actors.map(([id]) => id)).toEqual(['Alice', 'Zz9']);
    expect(after.messages.map((m) => m.to)).toEqual(['Zz9', 'Alice']);
  });

  it('changes only the alias of `participant A as Alice`', async () => {
    const code = lines('sequenceDiagram', 'participant A as Alice', 'participant B as Bob', 'A->>B: hi');
    const { map, after } = await rename(code, 'A', 'Zz9', 2);
    expect(map.participants.get('A')!.hasAlias).toBe(true);
    expect(after.actors).toEqual([
      ['A', 'Zz9'],
      ['B', 'Bob'],
    ]);
    expect(after.messages[0]).toMatchObject({ from: 'A', to: 'B' });
  });

  it('handles the actor keyword (with and without alias)', async () => {
    const code = lines('sequenceDiagram', 'actor Alice', 'actor B as Bobby', 'Alice->>B: hi');
    const a = await rename(code, 'Alice', 'Zz9');
    expect(a.after.actors.map(([id]) => id)).toEqual(['Zz9', 'B']);
    const b = await rename(code, 'B', 'Robert');
    expect(b.after.actors).toEqual([
      ['Alice', 'Alice'],
      ['B', 'Robert'],
    ]);
  });

  it('rejects a name that already exists (name_exists)', async () => {
    const code = lines('sequenceDiagram', 'participant Alice', 'participant Bob', 'Alice->>Bob: hi');
    const map = await mapOf(code);
    expect(renameParticipant(code, map, 'Alice', 'Bob')).toEqual({ ok: false, reason: 'name_exists' });
  });
});

describe('integration: editMessageText with the real parser', () => {
  it('edits only the second of two identical messages', async () => {
    const code = lines('sequenceDiagram', 'A->>B: same', 'A->>B: same');
    const { after } = await editText(code, 1, 'changed');
    expect(after.messages.map((m) => m.message)).toEqual(['same', 'changed']);
  });

  it('edits a message containing <br>', async () => {
    const code = lines('sequenceDiagram', 'A->>B: Hello<br>World', 'A->>B: x');
    const { after } = await editText(code, 0, 'One<br>Two<br>Three');
    expect(after.messages[0].message).toBe('One<br>Two<br>Three');
  });

  it('edits a message containing a #35; entity', async () => {
    const code = lines('sequenceDiagram', 'A->>B: Order #35;1', 'A->>B: x');
    const map = await mapOf(code);
    expect(sourceTextOf(map, 'messageText', 0)).toBe('Order #35;1');
    const { after } = await editText(code, 0, 'Order #35;2 done');
    expect(after.messages[0].message).toBe(encodeEntities('Order #35;2 done'));
  });

  it('keeps the wrap: prefix', async () => {
    const code = lines('sequenceDiagram', 'A->>B: wrap: long text here', 'A->>B:nowrap:short');
    const first = await editText(code, 0, 'new long');
    expect(first.code).toContain('A->>B: wrap: new long');
    const second = await editText(code, 1, 'newer');
    expect(second.code).toContain('A->>B:nowrap:newer');
  });

  it('gives an empty message `A->>B:` its first text', async () => {
    const code = lines('sequenceDiagram', 'A->>B:', 'A->>B: x');
    const { code: out, after } = await editText(code, 0, 'filled');
    expect(out).toBe(lines('sequenceDiagram', 'A->>B:filled', 'A->>B: x'));
    expect(after.messages[0].message).toBe('filled');
  });

  it('works with autonumber', async () => {
    const code = lines('sequenceDiagram', 'autonumber', 'A->>B: one', 'B->>A: two');
    const { after } = await editText(code, 1, 'second');
    expect(after.messages.some((m) => m.message === 'second')).toBe(true);
  });

  it('works with frontmatter, an init directive and comment lines', async () => {
    const code = lines(
      '---',
      'title: T',
      'config:',
      '  theme: forest',
      '---',
      '%%{init: {"sequence": {"mirrorActors": false}}}%%',
      'sequenceDiagram',
      '%% a comment',
      'participant Alice',
      '%% another',
      'Alice->>Bob: hi',
      '%% tail',
      'Bob->>Alice: yo',
    );
    const m = await editText(code, 1, 'edited');
    expect(m.after.messages.map((x) => x.message)).toEqual(['hi', 'edited']);
    const r = await rename(code, 'Alice', 'Zz9');
    expect(r.after.actors.map(([id]) => id)).toContain('Zz9');
  });

  it('works with \\r\\n line endings', async () => {
    const code = lines('sequenceDiagram', 'participant Alice', 'Alice->>Bob: hi', 'Bob->>Alice: yo').replace(/\n/g, '\r\n');
    const m = await editText(code, 0, 'edited');
    expect(m.code.split('\r\n').length).toBe(code.split('\r\n').length);
    const r = await rename(code, 'Bob', 'Zz9');
    expect(r.code).not.toMatch(/(?<!\r)\n/);
  });

  it('edits messages inside loop / alt / par blocks', async () => {
    const code = lines(
      'sequenceDiagram',
      'loop every minute',
      'A->>B: ping',
      'end',
      'alt ok',
      'B->>A: fine',
      'else bad',
      'B->>A: nope',
      'end',
      'par one',
      'A->>B: p1',
      'and two',
      'A->>B: p2',
      'end',
    );
    const before = await db(code);
    const map = await mapOf(code);
    const textIdx = [...map.messages.keys()];
    expect(textIdx.length).toBe(5);
    for (const i of textIdx) {
      const r = await editText(code, i, `edited ${i}`);
      expect(r.after.messages[i].message).toBe(`edited ${i}`);
      // block records untouched
      expect(r.after.messages.length).toBe(before.messages.length);
    }
  });

  it('rejects text with a newline (invalid_characters)', async () => {
    const code = lines('sequenceDiagram', 'A->>B: hi');
    const map = await mapOf(code);
    expect(editMessageText(code, map, 0, 'a\nb')).toEqual({ ok: false, reason: 'invalid_characters' });
  });

  it('rejects a map from code X applied to code Y (stale_source)', async () => {
    const x = lines('sequenceDiagram', 'A->>B: hi');
    const y = lines('sequenceDiagram', 'A->>B: ho');
    const map = await mapOf(x);
    expect(editMessageText(y, map, 0, 'z')).toEqual({ ok: false, reason: 'stale_source' });
    expect(renameParticipant(y, map, 'A', 'Zz9')).toEqual({ ok: false, reason: 'stale_source' });
  });
});

describe('integration: sourceTextOf returns raw source', () => {
  it('returns raw message text and participant labels', async () => {
    const code = lines(
      'sequenceDiagram',
      'participant A as Alice #35;1',
      'A->>B: Hello<br>World',
      'B->>A: wrap: wrapped',
      'B->>A:',
    );
    const map = await mapOf(code);
    expect(sourceTextOf(map, 'messageText', 0)).toBe('Hello<br>World');
    expect(sourceTextOf(map, 'messageText', 1)).toBe('wrapped');
    expect(sourceTextOf(map, 'messageText', 2)).toBe('');
    expect(sourceTextOf(map, 'participantLabel', 'A')).toBe('Alice #35;1');
    expect(sourceTextOf(map, 'participantLabel', 'B')).toBe('B');
  });
});

describe('integration: upstream corpus property test', () => {
  it('every message edit and one participant rename is ok or a documented rejection', async () => {
    const reasons: Record<string, number> = {};
    const bump = (k: string) => (reasons[k] = (reasons[k] ?? 0) + 1);
    const positionMismatch: string[] = [];
    const problems: string[] = [];
    let sourcesWithMap = 0;

    const sources = corpus.sources as string[];
    for (let si = 0; si < sources.length; si++) {
      const source = sources[si];
      const map = await getSourceMap(source);
      if (!map) continue;
      sourcesWithMap++;
      const before = await db(source);

      const check = async (label: string, res: ReturnType<typeof editMessageText>) => {
        if (!res.ok) {
          bump(`${label}:${res.reason}`);
          if (res.reason === 'position_mismatch') positionMismatch.push(`${label} source#${si}`);
          return;
        }
        bump(`${label}:ok`);
        try {
          const after = await db(res.code);
          if (after.messages.length !== before.messages.length) problems.push(`${label} source#${si}: message count changed`);
          if (after.actors.length !== before.actors.length) problems.push(`${label} source#${si}: actor count changed`);
          if ((await getSourceMap(res.code)) === null) problems.push(`${label} source#${si}: edited source not editable`);
        } catch (e) {
          problems.push(`${label} source#${si}: official parse failed: ${(e as Error).message.split('\n')[0]}`);
        }
      };

      for (const index of map.messages.keys()) {
        await check(`message#${index}`.replace(/\d+/, 'N'), editMessageText(source, map, index, `edited ${index}`));
      }
      for (const [id, loc] of map.participants) {
        if (!loc.hasAlias) {
          await check('rename', renameParticipant(source, map, id, 'Zz9'));
          break;
        }
      }
    }

     
    console.log(`corpus: ${sourcesWithMap} sources with a map; per-reason counts`, JSON.stringify(reasons, null, 1));
     
    if (positionMismatch.length) console.log('position_mismatch inputs:', positionMismatch.join('; '));
    expect(problems).toEqual([]);
    expect(positionMismatch).toEqual([]);
    expect(sourcesWithMap).toBeGreaterThan(50);
  }, 120_000);
});
