import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { POLICY_VERSION, incidentKey, verifyWebhook, assessRisk, releaseDecision, monitoringDecision, transition, publicIssue } from './control.mjs';
const sha = 'a'.repeat(40), live = 'b'.repeat(40);
const policy = { enabled: true, version: POLICY_VERSION, allowedFiles: ['src/utils/safe-format.ts'] };
const now = Date.parse('2026-11-08T12:00:00Z');
function fixture(variant = 'diagramly') {
  return { observedAt: new Date(now).toISOString(), artifactVerified: true, variant, killSwitch: false, candidateSha: sha, tagSha: sha, artifactSha: sha, reviewSha: sha, mainContainsCandidate: true, draftImmutable: true, newerThanLive: true, liveSha: live,
    delta: { sha, baseSha: live, complete: true, files: [{ path: 'src/utils/safe-format.ts', status: 'modified', binary: false, submodule: false, symlink: false, additions: 3, deletions: 1 }], semanticReview: { result: 'low', independent: true, sha, database: false, authentication: false, permissions: false, billing: false, sharedBackend: false, dependencies: false, dataMutation: false } },
    checks: Object.fromEntries(['unit', 'build', 'regression', 'staging', 'pvtPlan'].map(n => [n, { status: 'success', sha, trusted: true, variant }])),
    rollback: { verified: true, sha: live, variant }, exclusiveLease: true, inFlightReleases: 0,
    monitor: { available: true, releaseAttribution: true, baselineReady: true },
    prerequisite: { variant: variant === 'full' ? 'lite' : 'diagramly', sha, publishedAt: '2026-11-07T12:00:00Z', deployment: 'success', pvt: 'success', monitoring: 'healthy' },
  };
}

test('incident identity stable across deliveries and separated by project', () => {
  const ref = { organization: 'org', project: 'app', issueId: '123', environment: 'production' };
  assert.equal(incidentKey(ref), incidentKey({ ...ref, eventId: 'different' }));
  assert.notEqual(incidentKey(ref), incidentKey({ ...ref, project: 'other' }));
  assert.throws(() => incidentKey({ ...ref, environment: 'staging' }));
});
test('webhook verifies original bytes and rejects malformed signatures', () => {
  const body = Buffer.from('{"test":1}'), secret = 'x'.repeat(32);
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWebhook(body, sig, secret), true);
  for (const value of ['', 'z'.repeat(64), 'a'.repeat(64)]) assert.equal(verifyWebhook(body, value, secret), false);
  assert.equal(verifyWebhook(Buffer.from('{"test":2}'), sig, secret), false);
});
test('policy disabled and empty allowlist are fail closed', () => {
  assert.equal(releaseDecision(fixture(), {}, now).action, 'block');
  assert.equal(releaseDecision(fixture(), { ...policy, allowedFiles: [] }, now).action, 'block');
});
for (const variant of ['diagramly', 'lite', 'full']) test(`valid ${variant} evidence permits only existing draft publication`, () => {
  assert.equal(releaseDecision(fixture(variant), policy, now).action, 'publish_existing_draft');
});
test('AsyncAPI excluded even with all green evidence', () => assert.equal(releaseDecision(fixture('asyncapi'), policy, now).action, 'block'));
for (const path of ['functions/utils/format.ts', 'src/auth/login.ts', 'src/billing.ts', 'src/space-license.ts', 'src/oauth.ts', 'src/saveToPlatform.ts', 'src/../safe.ts', '.github/workflows/release.yml', 'manifest.yml', 'pnpm-lock.yaml']) test(`protected path: ${path}`, () => {
  const s = fixture(); s.delta.files[0].path = path;
  assert.equal(assessRisk(s.delta, { allowedFiles: [path] }).eligible, false);
});
for (const change of [s => s.tagSha = live, s => s.delta.baseSha = sha, s => s.delta.complete = false, s => s.killSwitch = true, s => s.inFlightReleases = 1, s => s.delta.semanticReview.permissions = true, s => s.delta.semanticReview.independent = false, s => s.delta.files[0].symlink = true, s => s.delta.files[0].status = 'renamed', s => s.delta.files[0].additions = NaN, s => s.rollback.verified = false, s => s.monitor.releaseAttribution = false]) test(`gate rejects missing or unsafe evidence: ${change}`, () => {
  const s = fixture(); change(s); assert.equal(releaseDecision(s, policy, now).action, 'block');
});
for (const status of ['skipped', 'cancelled', 'pending', 'failure']) test(`CI ${status} is not a pass`, () => {
  const s = fixture(); s.checks.unit.status = status; assert.equal(releaseDecision(s, policy, now).action, 'block');
});
test('checks must be trusted and for exact candidate/variant', () => {
  for (const change of [s => s.checks.unit.sha = live, s => s.checks.unit.variant = 'lite', s => s.checks.unit.trusted = false]) {
    const s = fixture(); change(s); assert.equal(releaseDecision(s, policy, now).action, 'block');
  }
});
test('Full 24h boundary and same SHA prerequisite', () => {
  const s = fixture('full');
  assert.equal(releaseDecision(s, policy, now - 1).action, 'block');
  assert.equal(releaseDecision(s, policy, now).action, 'publish_existing_draft');
  s.prerequisite.sha = live; assert.equal(releaseDecision(s, policy, now).action, 'block');
});
test('Lite waits for Diagramly PVT AND observation, not just published flag', () => {
  const s = fixture('lite'); s.prerequisite.monitoring = 'pending'; assert.equal(releaseDecision(s, policy, now).action, 'block');
});
const monitoring = { minRequests: 100, windowMinutes: 30, maxTargetErrors: 0, maxNewErrors: 2, maxRateIncrease: 0.01 };
const sample = { queryOk: true, attributionVerified: true, requests: 200, targetErrors: 0, newErrors: 0, baselineErrorRate: 0.01, windowMinutes: 30, pvt: 'success' };
test('monitor requires denominator and observation window', () => {
  assert.equal(monitoringDecision(sample, monitoring), 'healthy');
  for (const fields of [{ requests: 0 }, { windowMinutes: 5 }, { queryOk: false }, { attributionVerified: false }, { targetErrors: NaN }]) assert.equal(monitoringDecision({ ...sample, ...fields }, monitoring), 'inconclusive');
  assert.equal(monitoringDecision(sample, {}), 'inconclusive');
});
test('monitor requests rollback on recurrence, new error spike, or failed PVT', () => {
  for (const fields of [{ targetErrors: 1 }, { newErrors: 3 }, { pvt: 'failed' }]) assert.equal(monitoringDecision({ ...sample, ...fields }, monitoring), 'rollback_required');
});
test('transitions are replay-idempotent, revision-checked and require verdicts', () => {
  const run = { stage: 'received', revision: 0, events: [] };
  const e = { id: 'delivery-1', at: new Date(now).toISOString(), stage: 'fixing', revision: 1 };
  const next = transition(run, e);
  assert.equal(run.events.length, 0); assert.equal(transition(next, e), next);
  assert.throws(() => transition(next, { ...e, id: 'delivery-2' }));
  assert.throws(() => transition({ ...run, stage: 'testing' }, { ...e, stage: 'deploying' }));
  assert.throws(() => transition({ ...run, stage: 'monitoring' }, { ...e, stage: 'verified' }));
  assert.throws(() => transition({ ...run, stage: 'rollback_required' }, { ...e, stage: 'rolled_back' }));
});
test('public issue is allowlist-projected without raw Sentry/customer content', () => {
  const text = JSON.stringify(publicIssue({ organization: 'org', project: 'app', issueId: '123', environment: 'production', title: 'secret tenant', request: { authorization: 'secret' } }));
  assert.equal(text.includes('secret'), false);
});

test('authentication changes and unknown assessment block even in an allowed utility', () => {
  for (const value of [true, undefined]) {
    const s = fixture(); s.delta.semanticReview.authentication = value;
    assert.equal(releaseDecision(s, policy, now).action, 'block');
  }
});
test('failed PVT wins over unavailable Sentry telemetry', () => {
  assert.equal(monitoringDecision({ queryOk: false, pvt: 'failed' }, monitoring), 'rollback_required');
});
test('stale snapshots and unverified artifacts cannot publish', () => {
  const s = fixture();
  assert.equal(releaseDecision(s, policy, now + 60001).action, 'block');
  s.artifactVerified = false;
  assert.equal(releaseDecision(s, policy, now).action, 'block');
});
