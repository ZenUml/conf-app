#!/usr/bin/env node
import process from 'node:process';
// PR test decisions are written by repository collaborators, not inferred from labels.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { CATEGORIES, CATEGORY_VERSION } from '../../tests/e2e-tests/config/categories.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../tests/e2e-tests/config/impact-map.mjs';
import { POLICY_VERSION, EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from './classify.mjs';
import { selectAgentFloor } from '../e2e-select.mjs';
import { resolveSelection } from './resolve.mjs';
import { SCENARIO_COVERAGE, API_LANES, hasPrCoverage } from '../../tests/e2e-tests/config/scenario-coverage.mjs';
import { FEATURES, INTERFACES, SCENARIOS, scenarioKey, validScenarios, PRODUCT_IMPACT_FINGERPRINT } from '../../tests/e2e-tests/config/product-impact.mjs';

export const MARKER = '<!-- pr-test-decision:v2 -->';
const MARKER_PREFIX = '<!-- pr-test-decision:';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 20000;
const categoryIds = new Set(CATEGORIES.map(c => c.id));
const identity = pr => ({ pr_number: pr.number, head_sha: pr.head.sha, base_sha: pr.base.sha });
const sameIdentity = (a, b) => a.pr_number === b.pr_number && a.head_sha === b.head_sha && a.base_sha === b.base_sha;
export const catalog = {
  category_version: CATEGORY_VERSION,
  category_catalog_fingerprint: createHash('sha256').update(JSON.stringify(CATEGORIES)).digest('hex'),
  product_impact_fingerprint: PRODUCT_IMPACT_FINGERPRINT,
  scenario_coverage_fingerprint: createHash('sha256').update(JSON.stringify({ browser: SCENARIO_COVERAGE, api: API_LANES })).digest('hex'),
  policy_version: POLICY_VERSION,
  selector_catalog_version: EXECUTION_SELECTOR_CATALOG_VERSION,
  selector_catalog_fingerprint: EXECUTION_SELECTOR_CATALOG_FINGERPRINT,
};

export function githubApi(repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  return async (path, method = 'GET', body) => {
    const args = ['api', path.startsWith('/') ? `repos/${repo}${path}` : path, '--method', method];
    if (body !== undefined) args.push('--input', '-');
    const output = execFileSync('gh', args, { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    return output.trim() ? JSON.parse(output) : null;
  };
}

async function paginate(api, path) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Invalid GitHub page');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('Incomplete GitHub pagination');
}

export async function readContext(api, number) {
  if (!/^\d+$/.test(String(number)) || Number(number) < 1) throw new Error('Invalid PR number');
  const pr = await api(`/pulls/${number}`);
  if (pr.state !== 'open' || !sha(pr.head?.sha) || !sha(pr.base?.sha) || !Number.isSafeInteger(pr.changed_files)) throw new Error('PR is closed or its identity is invalid');
  const files = await paginate(api, `/pulls/${number}/files`);
  if (files.length !== pr.changed_files || files.length >= 3000) throw new Error('Incomplete changed-file discovery; triage required');
  const fresh = await api(`/pulls/${number}`);
  if (!sameIdentity(identity(pr), identity(fresh))) throw new Error('PR changed during discovery; retry');
  const paths = [...new Set(files.flatMap(f => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]))].sort();
  const removed_paths = [...new Set(files.flatMap(f => f.status === 'removed' ? [f.filename]
    : f.status === 'renamed' && f.previous_filename ? [f.previous_filename] : []))].sort();
  if (paths.some(p => typeof p !== 'string' || !p || /[\r\n\0]/.test(p))) throw new Error('Invalid changed path');
  const diff_fingerprint = createHash('sha256').update(JSON.stringify(files.map(f => [f.filename, f.previous_filename ?? null, f.status, f.sha]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');
  return { pr, files, paths, removed_paths, diff_fingerprint };
}

export function validateDecision(decision, context) {
  const fail = reason => ({ valid: false, reason });
  if (!decision || decision.schema_version !== 2 || !sameIdentity(decision, identity(context.pr))) return fail('missing-or-stale-decision');
  if (Object.entries(catalog).some(([key, value]) => decision[key] !== value)) return fail('stale-policy-or-catalog');
  if (decision.diff_fingerprint !== context.diff_fingerprint) return fail('changed-diff');
  if (!['selected', 'all', 'triage'].includes(decision.mode) || !['labeling', 'triage'].includes(decision.source) || !text(decision.reason) || !validScenarios(decision.scenarios) || 'categories' in decision) return fail('invalid-decision');
  if (decision.mode === 'selected' && decision.scenarios.some(pair => !hasPrCoverage(pair))) return fail('scenario-without-e2e-coverage');
  if (decision.mode === 'triage') return fail('triage-requested');
  if (decision.mode === 'all' && (decision.source !== 'triage' || !text(decision.full_reason))) return fail('full-needs-triage-approval');
  if (!Array.isArray(decision.evidence) || !decision.evidence.length) return fail('missing-path-evidence');
  const covered = new Set();
  const used = new Set();
  const selected = new Set(decision.scenarios.map(scenarioKey));
  for (const item of decision.evidence) {
    if (!Array.isArray(item.paths) || !item.paths.length || !item.paths.every(p => context.paths.includes(p)) || !text(item.reason) || !validScenarios(item.scenarios) || 'categories' in item) return fail('invalid-path-evidence');
    if (decision.mode === 'selected' && item.scenarios.some(pair => !selected.has(scenarioKey(pair)))) return fail('evidence-scenario-not-selected');
    item.scenarios.forEach(pair => used.add(scenarioKey(pair)));
    item.paths.forEach(p => covered.add(p));
  }
  if (decision.mode === 'selected' && [...selected].some(key => !used.has(key))) return fail('unused-selected-scenario');
  if (context.paths.some(p => !covered.has(p))) return fail('unreviewed-path');
  return { valid: true, reason: 'current-collaborator-decision' };
}

export function parseComment(comment) {
  if (!comment.body?.startsWith(`${MARKER}\n`) || comment.created_at !== comment.updated_at) return null;
  const match = /^<!-- pr-test-decision:v2 -->\n```json\n([\s\S]+)\n```\s*$/.exec(comment.body);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

const isControllerComment = comment => comment.user?.login === 'github-actions[bot]'
  && comment.performed_via_github_app?.slug === 'github-actions';

export async function recordDeletedDecision(api, context, event, eventName) {
  // Only the controller's trusted webhook payload supplies revocation evidence.
  // Leave a durable blocker: deleting a newer decision must not expose an older approval.
  const revokedBody = event?.action === 'edited' ? event.changes?.body?.from : event?.comment?.body;
  if (eventName !== 'issue_comment' || !['deleted', 'edited'].includes(event?.action)
      || event.issue?.number !== context.pr.number || !event.issue?.pull_request
      || !revokedBody?.startsWith(MARKER_PREFIX)
      || !Number.isSafeInteger(event.comment.id) || event.comment.id < 1) return false;
  if (!isControllerComment(event.comment)) {
    const login = event.comment.user?.login;
    if (!login) return false;
    let permission;
    try { permission = (await api(`/collaborators/${encodeURIComponent(login)}/permission`)).permission; }
    catch { return false; }
    if (!['admin', 'maintain', 'write'].includes(permission)) return false;
  }
  const comments = await paginate(api, `/issues/${context.pr.number}/comments`);
  if (comments.some(c => isControllerComment(c) && parseComment(c)?.revoked_comment_id === event.comment.id)) return false;
  const decision = {
    schema_version: 2, ...identity(context.pr), ...catalog, diff_fingerprint: context.diff_fingerprint,
    mode: 'triage', source: 'triage', scenarios: [], evidence: [],
    reason: `A PR test decision was ${event.action}; publish a fresh decision before running E2E.`,
    revoked_comment_id: event.comment.id,
  };
  await api(`/issues/${context.pr.number}/comments`, 'POST', {
    body: `${MARKER}\n\`\`\`json\n${JSON.stringify(decision, null, 2)}\n\`\`\``,
  });
  return true;
}

export async function findDecision(api, context) {
  const comments = await paginate(api, `/issues/${context.pr.number}/comments`);
  const permissions = new Map();
  // The newest trusted decision supersedes older decisions, including a triage request.
  for (const comment of comments.sort((a, b) => b.id - a.id)) {
    if (!comment.body?.startsWith(MARKER_PREFIX)) continue;
    const login = comment.user?.login;
    if (!login) continue;
    if (isControllerComment(comment)) {
      // The controller can revoke, but can never approve selected or full execution.
      // Edited/malformed controller records also block rather than exposing old approvals.
      const decision = parseComment(comment);
      return { valid: false, reason: decision?.mode === 'triage' ? 'decision-deleted' : 'invalid-controller-decision',
        comment_id: comment.id, author: login, url: comment.html_url };
    }
    if (!permissions.has(login)) {
      try { permissions.set(login, (await api(`/collaborators/${encodeURIComponent(login)}/permission`)).permission); }
      catch { return { valid: false, reason: 'collaborator-permission-unavailable', comment_id: comment.id }; }
    }
    if (!['admin', 'maintain', 'write'].includes(permissions.get(login))) continue;
    const decision = parseComment(comment);
    // Editing a decision invalidates it; never revive an older approval.
    if (!decision) return { valid: false, reason: 'edited-or-malformed-decision', comment_id: comment.id };
    const result = validateDecision(decision, context);
    return { ...result, decision, comment_id: comment.id, author: login, url: comment.html_url };
  }
  return { valid: false, reason: 'missing-collaborator-decision' };
}

export async function synchronize(api, context, result) {
  const number = context.pr.number;
  const current = await api(`/pulls/${number}`);
  if (!sameIdentity(identity(current), identity(context.pr))) throw new Error('PR changed before synchronization; retry');
  const desired = result.valid
    ? result.decision.mode === 'all' ? ['test:all-approved'] : ['test:selected', ...new Set(result.decision.scenarios.flatMap(pair => [`feature:${pair.feature}`, `interface:${pair.interface}`]))]
    : ['test:triage'];
  const managed = new Set(['test:triage', 'test:selected', 'test:all-approved', 'test:jev-all', 'test:all', ...[...categoryIds].map(id => `test:${id}`)]);
  const existing = await paginate(api, `/issues/${number}/labels`);
  // Fetch repository labels once; avoid treating every 422 as an existing label.
  const repoLabels = new Set((await paginate(api, '/labels')).map(label => label.name));
  for (const name of desired) if (!repoLabels.has(name)) {
    try { await api('/labels', 'POST', { name, color: name === 'test:triage' ? 'fbca04' : 'bfdadc', description: 'Current-commit PR E2E test decision' }); }
    catch { await api(`/labels/${encodeURIComponent(name)}`); } // A concurrent PR may have created it.
  }
  const added = desired.filter(name => !existing.some(label => label.name === name));
  if (added.length) await api(`/issues/${number}/labels`, 'POST', { labels: added });
  for (const label of existing) if ((managed.has(label.name) || label.name.startsWith('feature:') || label.name.startsWith('interface:')) && !desired.includes(label.name)) await api(`/issues/${number}/labels/${encodeURIComponent(label.name)}`, 'DELETE');
  if (!result.valid && !current.draft) await api('graphql', 'POST', {
    query: 'mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{id}}}', variables: { id: current.node_id },
  });
  return { mode: result.valid ? result.decision.mode : 'triage', executable: result.valid, reason: result.reason, labels: desired, comment_id: result.comment_id ?? null };
}

export async function publish(api, context, input) {
  // An already configured gh login is used, without introducing a model/API provider.
  const actor = await api('user');
  const permission = await api(`/collaborators/${encodeURIComponent(actor.login)}/permission`);
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) throw new Error('Publishing requires repository write permission');
  const decision = { ...input, ...catalog, diff_fingerprint: context.diff_fingerprint };
  const checked = validateDecision(decision, context);
  if (!checked.valid && checked.reason !== 'triage-requested') throw new Error(`Decision rejected: ${checked.reason}`);
  const current = await api(`/pulls/${context.pr.number}`);
  if (!sameIdentity(identity(current), identity(context.pr))) throw new Error('PR changed before publication; inspect again');
  await api(`/issues/${context.pr.number}/comments`, 'POST', { body: `${MARKER}\n\`\`\`json\n${JSON.stringify(decision, null, 2)}\n\`\`\`` });
  const latest = await readContext(api, context.pr.number);
  return synchronize(api, latest, await findDecision(api, latest));
}

export function selectionFromDecision(context, result, candidate, tree) {
  if (!result.valid || !sha(candidate) || !sha(tree)) throw new Error(`E2E blocked: ${result.reason}`);
  const { decision: d, comment_id } = result;
  return {
    schema_version: 1, ...catalog, selection_scope: 'pr', decision_source: 'agent', decision_id: comment_id,
    pr_number: context.pr.number, pr_head_sha: context.pr.head.sha, base_sha: context.pr.base.sha,
    head_sha: candidate, tested_tree: tree, source_paths: context.paths, removed_paths: context.removed_paths, source: d.source,
    mode: d.mode, execution_mode: 'enabled', decision_schema_version: 2, scenarios: d.scenarios, categories: Object.fromEntries(CATEGORIES.map(c => [c.id, { selected: false }])),
    required: ['smoke'], full_reason: d.full_reason ?? null, reason: d.reason, evidence: d.evidence,
    model: null, request: { outcome: 'not-requested', source: 'agent-skill' }, fallback_reason: null, diff_complete: true,
  };
}

export async function authorize(api, number, { candidate, expectedDecision, expectedMode, expectedGrep } = {}) {
  const context = await readContext(api, number);
  const result = await findDecision(api, context);
  if (!result.valid) throw new Error(`E2E blocked: ${result.reason}; invoke pr-triage manually`);
  if (expectedDecision && String(result.comment_id) !== String(expectedDecision)) throw new Error('E2E blocked: decision superseded');
  // Resolve the immutable tested merge and prove both parents still belong to this PR.
  const source = candidate || context.pr.merge_commit_sha;
  if (!sha(source)) throw new Error('E2E blocked: candidate merge is unavailable');
  const commit = await api(`/git/commits/${source}`);
  const parents = commit.parents?.map(p => p.sha) ?? [];
  const isHead = source === context.pr.head.sha;
  if (!isHead && (parents.length !== 2 || parents[0] !== context.pr.base.sha || parents[1] !== context.pr.head.sha)) throw new Error('E2E blocked: stale or unrelated candidate');
  const selection = selectionFromDecision(context, result, source, commit.tree?.sha);
  const resolved = resolveSelection({ selection, files: context.paths, head: source, tree: commit.tree.sha });
  if (!['selected', 'all'].includes(resolved.mode)) throw new Error('E2E blocked: invalid resolution');
  if (expectedMode && expectedMode !== resolved.mode || expectedGrep !== undefined && expectedGrep !== resolved.grep) throw new Error('E2E blocked: dispatch differs from decision');
  const fresh = await api(`/pulls/${number}`);
  if (!sameIdentity(identity(fresh), identity(context.pr))) throw new Error('E2E blocked: PR advanced during authorization');
  return { context, result, selection, resolved, candidate: source };
}

function args(argv) {
  const result = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error('Expected --name value');
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}

async function main() {
  const a = args(process.argv.slice(2));
  const repo = a.repo || process.env.GITHUB_REPOSITORY || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
  const api = githubApi(repo);
  if (a.command === 'check') {
    const authorized = await authorize(api, a.pr, { candidate: a.candidate, expectedDecision: a['decision-id'], expectedMode: a.mode, expectedGrep: a.grep });
    writeFileSync('test-selection.json', JSON.stringify(authorized.selection, null, 2));
    writeFileSync('selection.json', JSON.stringify(authorized.resolved, null, 2));
    writeFileSync('changed-files.txt', authorized.context.paths.join('\n') + '\n');
    const output = { mode: authorized.resolved.mode, grep: authorized.resolved.grep, candidate: authorized.candidate, 'pr-number': String(authorized.context.pr.number), 'decision-id': String(authorized.result.comment_id) };
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([k, v]) => `${k}=${v}\n`).join(''));
    console.log(JSON.stringify(output));
    return;
  }
  let context, discoveryFailure;
  try { context = await readContext(api, a.pr); }
  catch (error) {
    if (a.command !== 'sync' || !/^[1-9][0-9]*$/.test(String(a.pr))) throw error;
    const pr = await api(`/pulls/${a.pr}`);
    if (pr.state !== 'open') return;
    context = { pr, files: [], paths: [], removed_paths: [] };
    discoveryFailure = { valid: false, reason: 'changed-file-discovery-failed' };
  }
  if (a.command === 'inspect') {
    // The full diff is obtained separately with gh pr diff; this is its complete file inventory.
    console.log(JSON.stringify({ repo, ...identity(context.pr), files: context.files, source_paths: context.paths, removed_paths: context.removed_paths,
      floor: selectAgentFloor(context.paths, { removedPaths: context.removed_paths }), features: FEATURES, interfaces: INTERFACES, scenarios: SCENARIOS, uncovered_scenarios: SCENARIOS.filter(pair => !hasPrCoverage(pair)), ...catalog,
      decision_template: { schema_version: 2, ...identity(context.pr), mode: 'triage', source: 'labeling', scenarios: [], reason: '', evidence: [] } }, null, 2));
  } else if (a.command === 'publish') console.log(JSON.stringify(await publish(api, context, JSON.parse(readFileSync(a.file, 'utf8')))));
  else if (a.command === 'sync') {
    if (!discoveryFailure && process.env.GITHUB_EVENT_NAME === 'issue_comment' && process.env.GITHUB_EVENT_PATH) {
      await recordDeletedDecision(api, context, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), process.env.GITHUB_EVENT_NAME);
    }
    const result = discoveryFailure || await findDecision(api, context);
    const synced = await synchronize(api, context, result);
    if (process.env.PUBLISH_CHECK === 'true') await api('/check-runs', 'POST', {
      name: 'PR test decision', head_sha: context.pr.head.sha, status: 'completed', conclusion: result.valid ? 'success' : 'failure',
      output: { title: result.valid ? 'Current E2E scope approved' : 'Manual test triage required', summary: JSON.stringify({ ...synced, head_sha: context.pr.head.sha, decision_url: result.url ?? null }) },
    });
    console.log(JSON.stringify(synced));
  } else throw new Error('Usage: pr-decision.mjs inspect|publish|sync|check --pr NUMBER [--file decision.json]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
