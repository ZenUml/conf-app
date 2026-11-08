/** Private dashboard view model, not a public export. No rendering/framework,
 * no credential-bearing or arbitrary links, no raw Sentry payload propagation. */
const STAGES = new Set(['received', 'fixing', 'testing', 'blocked', 'deploying', 'monitoring', 'verified', 'rollback_required', 'rolled_back']);
const STATUSES = new Set(['pending', 'running', 'success', 'failure', 'blocked', 'inconclusive', 'healthy']);
const text = (v, max = 160) => typeof v === 'string' ? v.slice(0, max) : null;
function link(value, hosts) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash && hosts.includes(u.hostname) ? u.href : null;
  } catch { return null; }
}
function status(value) { return STATUSES.has(value) ? value : 'inconclusive'; }
export function dashboardRow(run, { sentryHosts = [] } = {}) {
  if (!/^[a-f0-9]{64}$/.test(run?.incidentKey ?? '')) throw new Error('Invalid incident key');
  return {
    incidentKey: run.incidentKey,
    attempt: Number.isSafeInteger(run.attempt) && run.attempt > 0 ? run.attempt : null,
    stage: STAGES.has(run.stage) ? run.stage : 'blocked',
    sentry: { issue: text(run.sentry?.issueId, 100), link: link(run.sentry?.url, sentryHosts) },
    github: { issue: link(run.github?.issueUrl, ['github.com']), pr: link(run.github?.prUrl, ['github.com']) },
    agent: { status: status(run.agent?.status), run: link(run.agent?.runUrl, ['github.com']) },
    tests: { status: status(run.tests?.status), run: link(run.tests?.runUrl, ['github.com']) },
    risk: { outcome: ['low', 'high', 'unknown'].includes(run.risk?.outcome) ? run.risk.outcome : 'unknown', policyVersion: text(run.risk?.policyVersion), reasonCodes: Array.isArray(run.risk?.reasonCodes) ? run.risk.reasonCodes.filter(v => typeof v === 'string' && /^[a-z_]{1,80}$/.test(v)).slice(0, 30) : [] },
    candidateSha: /^[a-f0-9]{40}$/.test(run.candidateSha ?? '') ? run.candidateSha : null,
    releases: ['diagramly', 'lite', 'full'].map(variant => {
      const r = run.releases?.[variant];
      return { variant, status: status(r?.status), url: link(r?.url, ['github.com']), monitoring: status(r?.monitoring), rollback: status(r?.rollback), earliestAt: Number.isFinite(Date.parse(r?.earliestAt)) ? new Date(r.earliestAt).toISOString() : null };
    }),
    updatedAt: Number.isFinite(Date.parse(run.updatedAt)) ? new Date(run.updatedAt).toISOString() : null,
  };
}
