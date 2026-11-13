import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceGroups } from '../shard-balance.mjs';

const item = (id, file) => ({ id, project: 'fullscreen', file });

test('balances estimated duration while preserving every atomic group', () => {
  const groups = [[item('a', 'heavy')], [item('b', 'light'), item('c', 'light')], [item('d', 'light')]];
  const shards = balanceGroups(groups, 2, { 'fullscreen:heavy': 120, 'fullscreen:light': 30 }, 40);
  assert.deepEqual(shards.map(s => s.map(t => t.id)), [['a'], ['b', 'c', 'd']]);
  assert.deepEqual(shards.flat().map(t => t.id).sort(), ['a', 'b', 'c', 'd']);
});

test('unknown or invalid timings use the default and ties are deterministic', () => {
  const groups = [[item('a', 'a')], [item('b', 'b')], [item('c', 'c')]];
  const weights = { 'fullscreen:a': 0, 'fullscreen:b': -1, 'fullscreen:c': 'bad' };
  const shards = balanceGroups(groups, 2, weights, 40);
  assert.deepEqual(shards.map(s => s.map(t => t.id)), [['a', 'c'], ['b']]);
  assert.deepEqual(shards, balanceGroups(groups, 2, weights, 40));
});

test('Lite planning keeps all selected tests and file groups intact', async () => {
  const { createPlan } = await import('../plan.mjs');
  const spec = (id, file) => ({ id, file, title: id, line: 1,
    tags: ['@smoke', '@test:sequence-render', '@variant:lite'], tests: [{ projectName: 'fullscreen' }] });
  const discovery = { config: { projects: [{ name: 'fullscreen' }] }, suites: [{ title: 'suite', specs: [
    spec('a', 'fullscreen/viewer-actions.spec.ts'), spec('b', 'fullscreen/viewer-actions.spec.ts'),
    spec('c', 'unmeasured-one.spec.ts'), spec('d', 'unmeasured-two.spec.ts'),
  ] }] };
  const plan = createPlan({ selection: null, discovery, variant: 'lite', tree: 'tree', policy: 'v1', shards: 2, scope: 'insert' });
  assert.deepEqual(plan.shards.flatMap(s => s.test_ids).sort(), ['a', 'b', 'c', 'd']);
  assert.ok(plan.shards.some(s => s.test_ids.includes('a') && s.test_ids.includes('b')));
  assert.deepEqual(plan, createPlan({ selection: null, discovery, variant: 'lite', tree: 'tree', policy: 'v1', shards: 2, scope: 'insert' }));
});
