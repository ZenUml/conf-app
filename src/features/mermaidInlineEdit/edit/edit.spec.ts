import { describe, expect, it } from 'vitest';
import { editMessageText } from './editMessageText';
import { renameParticipant } from './renameParticipant';
import { sourceTextOf } from './sourceTextOf';
import { buildMap, expectOnlyRangesChanged, findRange, idOccurrences, officialDb } from './testHelpers';
import type { EditRejection, EditResult, SequenceSourceMap } from '../types';

const BASIC = [
  'sequenceDiagram',
  '    %% header comment, keep me',
  '    box Aqua Group',
  '    participant A',
  '    participant B',
  '    end',
  '',
  '  A->>B: hello',
  '    activate B',
  '      Note over A,B: shared',
  '\tB-->>A: bye',
  '    deactivate B',
  '',
].join('\n');

const BASIC_MAP = () => buildMap(BASIC, { participants: { A: {}, B: {} } });

function expectFail(result: EditResult, reason: EditRejection) {
  expect(result).toEqual({ ok: false, reason });
}
function ok(result: EditResult): string {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.code;
}

describe('renameParticipant: rejections', () => {
  it('stale_source when the code differs from the map code', () => {
    expectFail(renameParticipant(BASIC + ' ', BASIC_MAP(), 'A', 'X'), 'stale_source');
    expectFail(renameParticipant(BASIC.replace('hello', 'hullo'), BASIC_MAP(), 'A', 'X'), 'stale_source');
  });

  it('position_mismatch for an unknown actor id', () => {
    expectFail(renameParticipant(BASIC, BASIC_MAP(), 'Nope', 'X'), 'position_mismatch');
  });

  it('position_mismatch when there are no ranges', () => {
    const map = BASIC_MAP();
    map.participants.get('A')!.idRanges = [];
    map.participants.get('A')!.labelRanges = [];
    expectFail(renameParticipant(BASIC, map, 'A', 'X'), 'position_mismatch');
  });

  it('position_mismatch when a range does not hold the actor id', () => {
    const map = BASIC_MAP();
    map.participants.get('A')!.idRanges.push(findRange(BASIC, 'hello'));
    expectFail(renameParticipant(BASIC, map, 'A', 'X'), 'position_mismatch');
  });

  it('position_mismatch for out-of-bounds, inverted or fractional ranges', () => {
    for (const bad of [[BASIC.length, BASIC.length + 1], [5, 2], [0.5, 1.5], [-1, 0]] as Array<[number, number]>) {
      const map = BASIC_MAP();
      map.participants.get('A')!.idRanges.push(bad);
      expectFail(renameParticipant(BASIC, map, 'A', 'X'), 'position_mismatch');
    }
  });

  it('position_mismatch when an alias range is empty or spans a line break', () => {
    const code = 'sequenceDiagram\nparticipant A as Alice\nA->>A: x\n';
    const map = buildMap(code, { participants: { A: { alias: 'Alice' } } });
    map.participants.get('A')!.labelRanges = [[code.indexOf('Alice'), code.indexOf('Alice')]];
    expectFail(renameParticipant(code, map, 'A', 'X'), 'position_mismatch');
    map.participants.get('A')!.labelRanges = [[code.indexOf('Alice'), code.indexOf('Alice') + 12]];
    expectFail(renameParticipant(code, map, 'A', 'X'), 'position_mismatch');
  });

  it('position_mismatch when ranges overlap with different content', () => {
    const map = BASIC_MAP();
    // Two ranges inside one word cannot both be applied.
    map.participants.set('A', { hasAlias: true, idRanges: [findRange(BASIC, 'A')], labelRanges: [[0, 6], [3, 8]] });
    expectFail(renameParticipant(BASIC, map, 'A', 'X'), 'position_mismatch');
  });

  it('empty for a blank name', () => {
    expectFail(renameParticipant(BASIC, BASIC_MAP(), 'A', ''), 'empty');
    expectFail(renameParticipant(BASIC, BASIC_MAP(), 'A', ' \t '), 'empty');
  });

  it('invalid_characters for ids and for alias text', () => {
    for (const bad of ['a\nb', 'a;b', 'a:b', 'a,b', 'a->b', 'end', 'a#b', 'Foo as Bar']) {
      expectFail(renameParticipant(BASIC, BASIC_MAP(), 'A', bad), 'invalid_characters');
    }
    const code = 'sequenceDiagram\nparticipant A as Alice\nA->>A: x\n';
    const map = buildMap(code, { participants: { A: { alias: 'Alice' } } });
    for (const bad of ['a\nb', 'a;b', 'a#b', 'wrap:x']) {
      expectFail(renameParticipant(code, map, 'A', bad), 'invalid_characters');
    }
  });

  it('name_exists when another participant already has that id', () => {
    expectFail(renameParticipant(BASIC, BASIC_MAP(), 'A', 'B'), 'name_exists');
    expectFail(renameParticipant(BASIC, BASIC_MAP(), 'A', '  B  '), 'name_exists');
  });
});

describe('renameParticipant: edits', () => {
  it('replaces the declaration, both message ends, activate, note and box member, and nothing else', async () => {
    const map = BASIC_MAP();
    const out = ok(renameParticipant(BASIC, map, 'B', 'Billing'));
    expectOnlyRangesChanged(BASIC, out, idOccurrences(BASIC, 'B'), 'Billing');
    expect(idOccurrences(BASIC, 'B').length).toBe(6); // decl, ->>B, activate, Note over A,B, B-->>, deactivate
    expect(out).toContain('%% header comment, keep me');
    const db = await officialDb(out);
    expect(db.actors.map(([id]) => id)).toEqual(['A', 'Billing']);
    expect(db.messages.filter((m) => m.message === 'hello')[0]).toMatchObject({ from: 'A', to: 'Billing' });
    expect(db.messages.filter((m) => m.message === 'bye')[0]).toMatchObject({ from: 'Billing', to: 'A' });
  });

  it('keeps the bytes of the original around the edit when the name has spaces', async () => {
    const out = ok(renameParticipant(BASIC, BASIC_MAP(), 'A', ' Order Service '));
    expectOnlyRangesChanged(BASIC, out, idOccurrences(BASIC, 'A'), 'Order Service');
    const db = await officialDb(out);
    expect(db.actors.map(([id]) => id)).toEqual(['Order Service', 'B']);
  });

  it('returns the same code when the name is unchanged', () => {
    expect(ok(renameParticipant(BASIC, BASIC_MAP(), 'A', 'A'))).toBe(BASIC);
    expect(ok(renameParticipant(BASIC, BASIC_MAP(), 'A', ' A '))).toBe(BASIC);
  });

  it('with an alias changes only the alias and keeps the id', async () => {
    const code = ['sequenceDiagram', 'participant S as Service', 'participant C as Client', 'C->>S: ping', 'S-->>C: pong', ''].join('\n');
    const map = buildMap(code, { participants: { S: { alias: 'Service' }, C: { alias: 'Client' } } });
    const out = ok(renameParticipant(code, map, 'S', 'Order Service (v2)'));
    expectOnlyRangesChanged(code, out, [findRange(code, 'Service')], 'Order Service (v2)');
    const db = await officialDb(out);
    expect(db.actors).toEqual([['S', 'Order Service (v2)'], ['C', 'Client']]);
    expect(db.messages[0]).toMatchObject({ from: 'C', to: 'S' });
  });

  it('allows an alias equal to another participant id (it is text, not an id)', () => {
    const code = 'sequenceDiagram\nparticipant A as Alice\nparticipant B\nA->>B: x\n';
    const map = buildMap(code, { participants: { A: { alias: 'Alice' }, B: {} } });
    expect(ok(renameParticipant(code, map, 'A', 'B'))).toBe('sequenceDiagram\nparticipant A as B\nparticipant B\nA->>B: x\n');
  });

  it('guards an alias that starts with %% so it is not read as a comment', async () => {
    const code = 'sequenceDiagram\nparticipant A as Alice\nA->>A: x\n';
    const map = buildMap(code, { participants: { A: { alias: 'Alice' } } });
    const out = ok(renameParticipant(code, map, 'A', '%% odd'));
    const db = await officialDb(out);
    expect(db.actors[0]).toEqual(['A', '%% odd']);
  });

  it('works on CRLF source without touching the line endings', async () => {
    const code = BASIC.replace(/\n/g, '\r\n');
    const map = buildMap(code, { participants: { A: {}, B: {} } });
    const out = ok(renameParticipant(code, map, 'A', 'Alpha'));
    expectOnlyRangesChanged(code, out, idOccurrences(code, 'A'), 'Alpha');
    expect(out.split('\r\n').length).toBe(code.split('\r\n').length);
    expect((out.match(/\n/g) ?? []).length).toBe((out.match(/\r\n/g) ?? []).length);
    const db = await officialDb(out);
    expect(db.actors.map(([id]) => id)).toEqual(['Alpha', 'B']);
  });

  it('does not rename inside longer words (whole-id ranges only)', () => {
    const code = 'sequenceDiagram\nparticipant A\nparticipant AB\nA->>AB: text\n';
    const map = buildMap(code, { participants: { A: {}, AB: {} } });
    expect(map.participants.get('A')!.idRanges.length).toBe(2); // declaration and message source; not "AB"
    expect(ok(renameParticipant(code, map, 'A', 'Z'))).toBe('sequenceDiagram\nparticipant Z\nparticipant AB\nZ->>AB: text\n');
  });
});

describe('editMessageText', () => {
  const messageText = (code: string, text: string, nth = 0) => findRange(code, text, nth);

  it('stale_source', () => {
    const map = buildMap(BASIC, { participants: {}, messages: { 0: { text: 'hello' } } });
    expectFail(editMessageText(BASIC + '\n', map, 0, 'x'), 'stale_source');
  });

  it('position_mismatch for a missing entry, a null range and bad ranges', () => {
    const map = buildMap(BASIC, { participants: {}, messages: { 0: { text: 'hello' }, 1: null } });
    expectFail(editMessageText(BASIC, map, 7, 'x'), 'position_mismatch');
    expectFail(editMessageText(BASIC, map, 1, 'x'), 'position_mismatch');
    const bad = buildMap(BASIC, { participants: {}, messages: { 0: { at: [BASIC.length, BASIC.length + 3] }, 1: { at: [9, 3] }, 2: { at: findRange(BASIC, 'hello\n    activate') } } });
    for (const i of [0, 1, 2]) expectFail(editMessageText(BASIC, bad, i, 'x'), 'position_mismatch');
  });

  it('position_mismatch when the range does not follow a ":"', () => {
    const map = buildMap(BASIC, { participants: {}, messages: { 0: { text: 'activate' } } });
    expectFail(editMessageText(BASIC, map, 0, 'x'), 'position_mismatch');
  });

  it('invalid_characters for newline, semicolon, raw # and a wrap directive', () => {
    const map = buildMap(BASIC, { participants: {}, messages: { 0: { text: 'hello' } } });
    for (const bad of ['a\nb', 'a\r\nb', 'a;b', 'a#b', '#', 'wrap:x', 'NoWrap: x', '#35;;']) {
      expectFail(editMessageText(BASIC, map, 0, bad), 'invalid_characters');
    }
  });

  it('replaces only the text range, trims, and keeps entities', async () => {
    const map = buildMap(BASIC, { participants: {}, messages: { 0: { text: 'hello' }, 1: { text: 'shared' }, 2: { text: 'bye' } } });
    const out = ok(editMessageText(BASIC, map, 0, '  Hi #quot;there#quot; (v2)  '));
    expectOnlyRangesChanged(BASIC, out, [messageText(BASIC, 'hello')], 'Hi #quot;there#quot; (v2)');
    const db = await officialDb(out);
    expect(db.messages[0]).toMatchObject({ from: 'A', to: 'B' });
    expect(db.messages[0].message).toContain('there');
    expect(db.messages[0].message).toContain('(v2)');
  });

  it('may be set to an empty text', async () => {
    const map = buildMap(BASIC, { participants: {}, messages: { 0: { text: 'hello' } } });
    const out = ok(editMessageText(BASIC, map, 0, ''));
    expect(out).toBe(BASIC.replace('A->>B: hello', 'A->>B: '));
    const db = await officialDb(out);
    expect(db.messages[0]).toMatchObject({ from: 'A', to: 'B', message: '' });
  });

  it('inserts into an empty range directly after ":"', async () => {
    const code = 'sequenceDiagram\nA->>B:\nB->>A:\n';
    const at = code.indexOf('A->>B:') + 'A->>B:'.length;
    const map = buildMap(code, { participants: {}, messages: { 0: { at: [at, at] } } });
    const out = ok(editMessageText(code, map, 0, 'hi'));
    expect(out).toBe('sequenceDiagram\nA->>B:hi\nB->>A:\n');
    const db = await officialDb(out);
    expect(db.messages[0]).toMatchObject({ from: 'A', to: 'B', message: 'hi' });
  });

  it('guards a text that starts with %% directly after ":"', async () => {
    const code = 'sequenceDiagram\nA->>B:x\n';
    const at = code.indexOf('x\n');
    const map = buildMap(code, { participants: {}, messages: { 0: { at: [at, at + 1] } } });
    const out = ok(editMessageText(code, map, 0, '%% note'));
    const db = await officialDb(out);
    expect(db.messages[0].message).toBe('%% note');
  });

  it('keeps text after a wrap: prefix as a directive', async () => {
    const code = 'sequenceDiagram\nA->>B:wrap: long text\n';
    const map = buildMap(code, { participants: {}, messages: { 0: { text: 'long text' } } });
    const out = ok(editMessageText(code, map, 0, 'short'));
    expect(out).toBe('sequenceDiagram\nA->>B:wrap: short\n');
    const db = await officialDb(out);
    expect(db.messages[0].message).toBe('short');
  });

  it('two identical lines: editing the second changes only the second', async () => {
    const code = ['sequenceDiagram', 'A->>B: ping', 'B-->>A: ok', 'A->>B: ping', 'B-->>A: ok', ''].join('\n');
    const map = buildMap(code, { participants: {}, messages: { 0: { text: 'ping', nth: 0 }, 2: { text: 'ping', nth: 1 }, 1: { text: 'ok', nth: 0 }, 3: { text: 'ok', nth: 1 } } });
    const out = ok(editMessageText(code, map, 2, 'pong'));
    expect(out).toBe(['sequenceDiagram', 'A->>B: ping', 'B-->>A: ok', 'A->>B: pong', 'B-->>A: ok', ''].join('\n'));
    const db = await officialDb(out);
    expect(db.messages.map((m) => m.message)).toEqual(['ping', 'ok', 'pong', 'ok']);
  });

  it('keeps comments, blank lines, odd indentation and CRLF byte for byte', async () => {
    const code = ['sequenceDiagram', '%% c1', '', '   A->>B:   spaced  ', '\t\t%% c2', 'B-->>A:ok', ''].join('\r\n');
    const map = buildMap(code, { participants: {}, messages: { 0: { text: 'spaced' }, 1: { text: 'ok' } } });
    const out = ok(editMessageText(code, map, 0, 'fixed'));
    expectOnlyRangesChanged(code, out, [findRange(code, 'spaced')], 'fixed');
    expect(out).toBe(code.replace('spaced', 'fixed'));
    const db = await officialDb(out);
    expect(db.messages.map((m) => m.message)).toEqual(['fixed', 'ok']);
  });
});

describe('sourceTextOf', () => {
  const code = 'sequenceDiagram\nparticipant S as Order #quot;Svc#quot;\nparticipant C\nC->>S:wrap:  hi #35; there\nS-->>C:\n';
  const map: SequenceSourceMap = buildMap(code, {
    participants: { S: { alias: 'Order #quot;Svc#quot;' }, C: {}, X: undefined },
    messages: { 0: { text: 'hi #35; there' }, 1: { at: [code.length - 1, code.length - 1] }, 2: null },
  });

  it('returns the raw alias, the id for plain participants and the raw message text', () => {
    expect(sourceTextOf(map, 'participantLabel', 'S')).toBe('Order #quot;Svc#quot;');
    expect(sourceTextOf(map, 'participantLabel', 'C')).toBe('C');
    expect(sourceTextOf(map, 'messageText', 0)).toBe('hi #35; there');
  });

  it('returns an empty string for an empty message and null for unknown or null targets', () => {
    expect(sourceTextOf(map, 'messageText', 1)).toBe('');
    expect(sourceTextOf(map, 'messageText', 2)).toBeNull();
    expect(sourceTextOf(map, 'messageText', 9)).toBeNull();
    expect(sourceTextOf(map, 'participantLabel', 'nope')).toBeNull();
    expect(sourceTextOf(map, 'participantLabel', 'X')).toBeNull();
  });

  it('returns null for a range outside the source', () => {
    const bad = buildMap(code, { participants: {}, messages: { 0: { at: [code.length, code.length + 5] } } });
    expect(sourceTextOf(bad, 'messageText', 0)).toBeNull();
  });
});
