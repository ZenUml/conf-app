import assert from 'node:assert/strict';
import test from 'node:test';
import { newErrors, parseErrors, total } from '../typecheck-functions-ratchet.mjs';

const sample = [
  "functions/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "functions/a.ts(20,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  '  Types of property x are incompatible.',
  "functions/b.ts(1,1): error TS7006: Parameter 'x' implicitly has an 'any' type.",
].join('\n');

test('parseErrors drops positions, keeps duplicates, ignores continuation lines', () => {
  const counts = parseErrors(sample);
  assert.equal(total(counts), 3);
  assert.equal(counts.get("functions/a.ts: error TS2322: Type 'string' is not assignable to type 'number'."), 2);
});

test('newErrors ignores line moves and reports only the surplus', () => {
  const base = parseErrors(sample);
  const moved = parseErrors(sample.replaceAll('(10,5)', '(99,5)'));
  assert.deepEqual(newErrors(base, moved), []);
  const worse = parseErrors(`${sample}\nfunctions/c.ts(3,3): error TS2305: Module has no exported member 'Env'.`);
  assert.deepEqual(newErrors(base, worse), ["functions/c.ts: error TS2305: Module has no exported member 'Env'."]);
});
