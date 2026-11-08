import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardRow } from './dashboard.mjs';
const base = { incidentKey: 'a'.repeat(64), stage: 'received' };
test('one incident row exposes every lifecycle and variant, excludes AsyncAPI', () => {
  const row = dashboardRow(base);
  assert.deepEqual(row.releases.map(r => r.variant), ['diagramly', 'lite', 'full']);
  for (const key of ['sentry', 'github', 'agent', 'tests', 'risk', 'candidateSha', 'updatedAt']) assert.ok(key in row);
  assert.equal(row.risk.outcome, 'unknown');
});
test('dashboard links reject executable, credential-bearing and unexpected hosts', () => {
  for (const url of ['javascript:alert(1)', 'https://github.com.evil.test/x', 'https://token@github.com/x', 'https://github.com/x?token=x', 'http://github.com/x']) assert.equal(dashboardRow({ ...base, github: { prUrl: url } }).github.pr, null);
  assert.equal(dashboardRow({ ...base, github: { prUrl: 'https://github.com/ZenUml/conf-app/pull/1' } }).github.pr, 'https://github.com/ZenUml/conf-app/pull/1');
});
test('dashboard drops raw telemetry and unrecognized status', () => {
  const row = dashboardRow({ ...base, stage: 'arbitrary', request: { authorization: 'secret' }, risk: { reasonCodes: ['protected_path', 'private tenant name'] } });
  assert.equal(row.stage, 'blocked');
  assert.deepEqual(row.risk.reasonCodes, ['protected_path']);
  assert.equal(JSON.stringify(row).includes('secret'), false);
});
