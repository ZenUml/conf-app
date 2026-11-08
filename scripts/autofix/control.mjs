/** Pure policy core, not an authorization boundary. Trusted adapters must collect
 * every evidence field; never accept an issue body/agent's assertion as evidence.
 * No network, credentials, deployment, or persistent storage in this module. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const POLICY_VERSION = 'conf-app-autofix-v1';
export const VARIANTS = ['diagramly', 'lite', 'full'];
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const DENIED = /(^|\/)(migrations?|schema|permissions?|auth[^/]*|billing|stripe[^/]*|license[^/]*|paywall[^/]*|secrets?)(\/|[._-]|$)/i;
const SENSITIVE = /(?:authenticate|authorization|space.?license|space.?status|payment|oauth|headless|token|forgeRequest|saveToPlatform|storage|persist|writeback|delete)/i;
const CHECKS = ['unit', 'build', 'regression', 'staging', 'pvtPlan'];

export function incidentKey({ organization, project, issueId, environment }) {
  if (![organization, project, issueId].every(x => typeof x === 'string' && ID.test(x)) || environment !== 'production') {
    throw new Error('Require validated organization, project, issue ID and production environment');
  }
  return createHash('sha256').update(JSON.stringify([organization, project, issueId, environment])).digest('hex');
}

// Signature verification only: adapter must bind expected integration, reject stale
// event IDs with a durable dedupe store, and limit body size before this function.
export function verifyWebhook(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 262144 || typeof secret !== 'string' || secret.length < 32 || !/^[a-f0-9]{64}$/i.test(signature ?? '')) return false;
  const actual = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(actual, Buffer.from(signature, 'hex'));
}

/** Human-reviewed exact-file allowlist, empty by default. A small diff alone is
 * never low risk. Paths come from the full previous-production-to-candidate diff,
 * including old paths for renames. Both semantic review and deterministic gates
 * are mandatory. Policy itself must be read from trusted base, not PR head. */
export function assessRisk(delta, policy = {}) {
  const reasons = [];
  if (delta?.complete !== true || !Array.isArray(delta?.files) || delta.files.length === 0) return { eligible: false, reasons: ['incomplete_delta'] };
  if (delta.files.length > 5) reasons.push('too_many_files');
  let lines = 0;
  for (const file of delta.files) {
    if (!['modified', 'added'].includes(file.status)) reasons.push('unsupported_file_operation');
    if (file.binary !== false || file.submodule !== false || file.symlink !== false) reasons.push('unsupported_file_type');
    if (!Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions) || file.additions < 0 || file.deletions < 0) reasons.push('invalid_diff_stats');
    else lines += file.additions + file.deletions;
    for (const path of [file.path, file.previousPath].filter(x => x !== undefined)) {
      if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) || path.split('/').includes('..') || path.startsWith('/')) { reasons.push('invalid_path'); continue; }
      if (DENIED.test(path) || SENSITIVE.test(path) || !path.startsWith('src/') || /\.(json|ya?ml)$/.test(path)) reasons.push('protected_path');
      if (!Array.isArray(policy.allowedFiles) || !policy.allowedFiles.includes(path)) reasons.push('path_not_allowlisted');
    }
    if (typeof file.path !== 'string') reasons.push('missing_path');
  }
  if (lines > 120) reasons.push('diff_too_large');
  if (delta.semanticReview?.result !== 'low' || delta.semanticReview?.independent !== true || delta.semanticReview?.sha !== delta.sha || !SHA.test(delta.sha ?? '')) reasons.push('missing_independent_risk_review');
  for (const category of ['database', 'authentication', 'permissions', 'billing', 'sharedBackend', 'dependencies', 'dataMutation']) {
    if (delta.semanticReview?.[category] !== false) reasons.push(`risk_${category}`);
  }
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Snapshot is collected by trusted service adapters at decision time. */
export function releaseDecision(snapshot, policy, now = Date.now()) {
  const reasons = [];
  const s = snapshot ?? {};
  const sha = s.candidateSha;
  if (!Number.isFinite(now)) reasons.push('invalid_clock');
  const observedAt = Date.parse(s.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt > 60000) reasons.push('stale_snapshot');
  if (s.artifactVerified !== true) reasons.push('unverified_artifact');
  if (policy?.enabled !== true || policy?.version !== POLICY_VERSION) reasons.push('policy_disabled');
  if (s.killSwitch !== false) reasons.push('kill_switch_or_unknown');
  if (!VARIANTS.includes(s.variant)) reasons.push('variant_excluded');
  if (!SHA.test(sha ?? '') || s.tagSha !== sha || s.artifactSha !== sha || s.reviewSha !== sha) reasons.push('candidate_mismatch');
  if (s.mainContainsCandidate !== true || s.draftImmutable !== true || s.newerThanLive !== true) reasons.push('invalid_release_candidate');
  if (s.delta?.sha !== sha || s.delta?.baseSha !== s.liveSha || !SHA.test(s.liveSha ?? '')) reasons.push('production_delta_mismatch');
  const risk = assessRisk(s.delta, policy);
  reasons.push(...risk.reasons);
  for (const name of CHECKS) {
    const c = s.checks?.[name];
    if (c?.status !== 'success' || c?.sha !== sha || c?.trusted !== true || c?.variant !== s.variant) reasons.push(`check_${name}`);
  }
  if (s.rollback?.verified !== true || s.rollback?.sha !== s.liveSha || s.rollback?.variant !== s.variant) reasons.push('rollback_unproven');
  if (s.exclusiveLease !== true || s.inFlightReleases !== 0) reasons.push('release_busy');
  if (s.monitor?.available !== true || s.monitor?.releaseAttribution !== true || s.monitor?.baselineReady !== true) reasons.push('monitor_not_ready');
  // No unreviewed co-shipped main changes: risk assessed against LIVE SHA above.
  if (s.variant === 'lite' || s.variant === 'full') {
    const expected = s.variant === 'lite' ? 'diagramly' : 'lite';
    const p = s.prerequisite;
    const at = Date.parse(p?.publishedAt);
    if (p?.variant !== expected || p?.sha !== sha || p?.deployment !== 'success' || p?.pvt !== 'success' || p?.monitoring !== 'healthy' || !Number.isFinite(at) || at > now) reasons.push('prerequisite_not_verified');
    if (s.variant === 'full' && (!Number.isFinite(at) || now - at < 86400000)) reasons.push('full_soak_incomplete');
  }
  return { action: reasons.length ? 'block' : 'publish_existing_draft', policyVersion: POLICY_VERSION, reasons: [...new Set(reasons)], candidateSha: sha, variant: s.variant };
}

/** No traffic or a broken query is not evidence that the fix worked. Thresholds
 * are explicit policy, not defaults guessed from one Sentry error count. */
export function monitoringDecision(sample, policy) {
  // PVT is an independent trusted probe; telemetry outage cannot erase failure.
  if (sample?.pvt === 'failed') return 'rollback_required';
  const numeric = ['requests', 'targetErrors', 'newErrors', 'baselineErrorRate', 'windowMinutes'];
  if (!sample || sample.queryOk !== true || sample.attributionVerified !== true || numeric.some(k => !Number.isFinite(sample[k]) || sample[k] < 0)) return 'inconclusive';
  const keys = ['minRequests', 'windowMinutes', 'maxTargetErrors', 'maxNewErrors', 'maxRateIncrease'];
  if (!policy || keys.some(k => !Number.isFinite(policy[k]) || policy[k] < 0) || policy.minRequests < 1 || policy.windowMinutes < 1) return 'inconclusive';
  if (sample.targetErrors > policy.maxTargetErrors || sample.newErrors > policy.maxNewErrors) return 'rollback_required';
  if (sample.requests < policy.minRequests || sample.windowMinutes < policy.windowMinutes || sample.pvt !== 'success') return 'inconclusive';
  if (sample.targetErrors / sample.requests - sample.baselineErrorRate > policy.maxRateIncrease) return 'rollback_required';
  return 'healthy';
}

const TRANSITIONS = {
  received: ['fixing', 'blocked'], fixing: ['testing', 'blocked'], testing: ['deploying', 'blocked'],
  deploying: ['monitoring', 'rollback_required', 'blocked'], monitoring: ['verified', 'rollback_required', 'blocked'],
  rollback_required: ['rolled_back', 'blocked'], blocked: ['fixing', 'testing', 'monitoring'],
  verified: [], rolled_back: [],
};

/** Append-only event reducer. Store must enforce CAS on revision + unique event
 * ID transactionally. Reducer alone provides neither locking nor authenticity. */
export function transition(run, event) {
  if (!run || !event || !ID.test(event.id ?? '') || !Number.isFinite(Date.parse(event.at))) throw new Error('Invalid event');
  if (run.events.some(e => e.id === event.id)) return run;
  if (event.revision !== run.revision + 1 || !TRANSITIONS[run.stage]?.includes(event.stage)) throw new Error('Invalid transition or stale revision');
  if (event.stage === 'deploying' && event.decision?.action !== 'publish_existing_draft') throw new Error('Release gate required');
  if (event.stage === 'verified' && event.verdict !== 'healthy') throw new Error('Healthy observation required');
  if (event.stage === 'rolled_back' && event.rollbackVerified !== true) throw new Error('Verified rollback required');
  const next = { id: event.id, at: event.at, stage: event.stage, revision: event.revision };
  return { ...run, stage: event.stage, revision: event.revision, events: [...run.events, next] };
}

// Strict public projection: never forward error titles, stack, body, users,
// request headers, tenant names or arbitrary URLs to the PUBLIC GitHub repo.
export function publicIssue(reference) {
  const key = incidentKey(reference);
  return { title: `Production incident ${key.slice(0, 12)}`, body: `Autofix correlation: ${key}\n\nEvidence and customer context remain in the private incident dashboard.\nStatus: awaiting trusted triage.` };
}
