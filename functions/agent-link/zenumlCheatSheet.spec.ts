import { describe, it, expect } from 'vitest';
import { parseDsl } from './parseDsl';
import { ZENUML_RENDER_CHEAT_SHEET } from './zenumlDslGuide';

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
