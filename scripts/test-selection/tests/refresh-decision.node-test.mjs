import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseVerdict, refreshedInput } from '../../../.claude/skills/pr-triage/scripts/refresh-decision.mjs';

const catalog = { policy_version: 'p1', selector_catalog_fingerprint: 'c1' };
const context = { diff_fingerprint: 'd1', pr: { number: 7, head: { sha: 'h'.repeat(40) }, base: { sha: 'b'.repeat(40) } } };
const old = {
  schema_version: 2, mode: 'selected', source: 'triage', scenarios: [], reason: 'smoke only', evidence: [{ paths: ['a.ts'], reason: 'r', scenarios: [] }],
  diff_fingerprint: 'd1', ...catalog,
};
const stale = { valid: false, reason: 'missing-or-stale-decision', decision: old, comment_id: 1 };

test('a current decision needs nothing', () => {
  assert.equal(reuseVerdict({ valid: true, decision: old }, context, catalog).action, 'current');
});

test('a selected decision stale only by head/base identity is refreshed', () => {
  const verdict = reuseVerdict(stale, context, catalog);
  assert.equal(verdict.action, 'refresh');
  assert.equal(verdict.decision, old);
});

test('a changed diff, catalog, or mode is never reused', () => {
  assert.deepEqual(reuseVerdict(stale, { ...context, diff_fingerprint: 'd2' }, catalog), { action: 'manual', reason: 'diff-changed' });
  assert.equal(reuseVerdict(stale, context, { ...catalog, policy_version: 'p2' }).reason, 'catalog-or-policy-changed');
  assert.match(reuseVerdict({ ...stale, decision: { ...old, mode: 'all' } }, context, catalog).reason, /only a selected decision/);
  assert.match(reuseVerdict({ ...stale, decision: { ...old, mode: 'triage' } }, context, catalog).reason, /only a selected decision/);
});

test('no collaborator decision, or a revoked one, needs manual triage', () => {
  assert.deepEqual(reuseVerdict({ valid: false, reason: 'missing-collaborator-decision' }, context, catalog),
    { action: 'manual', reason: 'missing-collaborator-decision' });
  assert.equal(reuseVerdict({ valid: false, reason: 'decision-deleted', comment_id: 2 }, context, catalog).action, 'manual');
});

test('other validation failures are not papered over', () => {
  assert.equal(reuseVerdict({ ...stale, reason: 'invalid-path-evidence' }, context, catalog).reason, 'invalid-path-evidence');
});

test('the refreshed input keeps the reviewed substance and takes the current identity', () => {
  const input = refreshedInput(old, context);
  assert.deepEqual(input, {
    schema_version: 2, pr_number: 7, head_sha: 'h'.repeat(40), base_sha: 'b'.repeat(40),
    mode: 'selected', source: 'triage', scenarios: [], reason: 'smoke only', evidence: old.evidence,
  });
  assert.ok(!('diff_fingerprint' in input), 'the helper stamps the fingerprint itself');
});
