import { describe, it, expect } from 'vitest';
import { parseDsl } from './parseDsl';
import { ZENUML_RENDER_CHEAT_SHEET, lintZenuml, zenumlFailureHints } from './zenumlDslGuide';

// Every example the cheat sheet teaches is run through the same parser
// render_diagram uses, so the text cannot drift from what is accepted.
const accepted: Array<[string, string]> = [
  ['nested block', 'A->B.method() {\n  C.other()\n}'],
  ['assignment', 'x = B.get()'],
  ['if / else', 'if (cond) {\n  A.go()\n} else {\n  A.stop()\n}'],
  ['return', 'A->B.m() {\n  return x\n}'],
  ['comment', '// note\nA.go()'],
  ['actor and database', '@Actor User\n@Database DB\nUser->DB.q()'],
  ['quoted method', 'A->B."GET /x"()'],
  ['group before the first message', 'group "Backend" {\n  B\n  C\n}\nA->B: msg\nB->C: y'],
];
const rejected: Array<[string, string]> = [
  ['block after an async message', 'A->B: POST /x {\n  B->C: y\n}'],
  ['group after a message', 'A->B: msg\ngroup "x" {\n  A->B: msg\n}\nB->C: z'],
];

describe('ZenUML cheat sheet claims, checked against the parser', () => {
  for (const [name, src] of accepted) {
    it(`accepts: ${name}`, async () => {
      expect((await parseDsl('sequence', src)).ok).toBe(true);
    });
  }
  for (const [name, src] of rejected) {
    it(`rejects: ${name}`, async () => {
      expect((await parseDsl('sequence', src)).ok).toBe(false);
    });
  }

  it('states each of the claims', () => {
    for (const piece of [
      'A->B.method() { C.other() }',
      'x = B.get()',
      'if (cond) { } else { }',
      'return x',
      '// comment',
      '@Actor User',
      '@Database DB',
      'B."GET /x"()',
      'async',
      'group',
    ]) {
      expect(ZENUML_RENDER_CHEAT_SHEET).toContain(piece);
    }
  });
});

// Mistakes that parse but draw the wrong diagram. Each case is first run
// through the parser, so the test proves the source is accepted AND flagged.
describe('lintZenuml: parsed sources that draw the wrong diagram', () => {
  const flagged: Array<[string, string, string, number, number]> = [
    ['message inside a group', 'group "Backend" {\n  A->B: msg\n}\nB->C: z', 'group_with_messages', 1, 0],
    ['brace on the line after group', 'group "x"\n{\n  A->B: msg\n}', 'group_with_messages', 1, 0],
    ['unnamed group with a call', 'group {\n  A.go()\n}', 'group_with_messages', 1, 0],
    ['indented group', 'A\n  group G {\n    x = B.get()\n  }', 'group_with_messages', 2, 2],
    ['one-line block after an async message', 'A->B: POST /orders { B->C: save() }', 'block_in_async_message', 1, 19],
    ['one-line block holding a call', 'A->B: go { C.run() }', 'block_in_async_message', 1, 9],
  ];
  for (const [name, src, code, line, col] of flagged) {
    it(`flags: ${name}`, async () => {
      expect((await parseDsl('sequence', src)).ok).toBe(true);
      const issues = lintZenuml(src);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual(expect.objectContaining({ code, line, col }));
      expect(issues[0].message.length).toBeGreaterThan(20);
    });
  }

  const clean: Array<[string, string]> = [
    ['participants-only group', 'group "Backend" {\n  B\n  C\n}\nA->B: msg'],
    ['empty group', 'group "x" {}\nA->B: m'],
    ['braces in a label with no message inside', 'A->B: {"id":1}'],
    ['arrow inside a comment in a group', 'group "x" {\n  B // B->C later\n}\nA->B: m'],
    ['braces and arrow inside a quoted label', 'A->B: "send { B->C } now"'],
    ['nested call block', 'A->B.method() {\n  C.other()\n}'],
    ['plain diagram', '@Actor User\nUser->API.get() {\n  if (ok) { return x }\n}'],
  ];
  for (const [name, src] of clean) {
    it(`does not flag: ${name}`, async () => {
      expect((await parseDsl('sequence', src)).ok).toBe(true);
      expect(lintZenuml(src)).toEqual([]);
    });
  }

  it('names the participants of the flagged message in its fix', () => {
    expect(lintZenuml('Web->Api: POST /orders { Api->Db: save() }')[0].message).toContain('Web->Api.method() {');
  });
});

describe('zenumlFailureHints: targeted fixes for failed parses', () => {
  async function hintsFor(src: string) {
    const parsed = await parseDsl('sequence', src);
    expect(parsed.ok).toBe(false);
    return zenumlFailureHints(src, parsed.ok ? [] : parsed.errors);
  }

  it('group after the first message: at the line and column the parser gives', async () => {
    const hints = await hintsFor('A->B: msg\ngroup "x" {\n  B\n}\nB->C: z');
    expect(hints).toEqual([expect.objectContaining({ code: 'group_after_message', line: 2, col: 0 })]);
  });

  it('group after a method call', async () => {
    const hints = await hintsFor('A.m()\ngroup x { B }');
    expect(hints).toEqual([expect.objectContaining({ code: 'group_after_message', line: 2, col: 0 })]);
  });

  it('multi-line block after an async message: at the message, not at the closing brace', async () => {
    const hints = await hintsFor('A->B: POST /x {\n  B->C: y\n}');
    expect(hints).toEqual([expect.objectContaining({ code: 'block_after_async_message', line: 1, col: 14 })]);
    expect(hints[0].message).toContain('A->B.method() {');
  });

  it('gives no hint for a mistake it does not recognise', async () => {
    expect(await hintsFor('A->B.m(')).toEqual([]);
  });
});
