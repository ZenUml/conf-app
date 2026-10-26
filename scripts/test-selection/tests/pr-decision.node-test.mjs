import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKER, catalog, readContext, validateDecision, findDecision, authorize, publish, synchronize, recordDeletedDecision } from '../pr-decision.mjs';
import { CATEGORIES } from '../../../tests/e2e-tests/config/categories.mjs';

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), MERGE = 'c'.repeat(40), TREE = 'd'.repeat(40);
const category = CATEGORIES[0].id;
const comment = (decision, id = 10, overrides = {}) => ({
  id, body: `${MARKER}\n\`\`\`json\n${JSON.stringify(decision)}\n\`\`\``, user: { login: 'maintainer' },
  created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', html_url: `https://github.com/example/repo/pull/42#issuecomment-${id}`, ...overrides,
});

async function fixture() {
  const state = {
    pr: { number: 42, state: 'open', node_id: 'PR_example', draft: true, changed_files: 1, head: { sha: HEAD }, base: { sha: BASE }, merge_commit_sha: MERGE },
    files: [{ filename: 'docs/guide.md', status: 'modified', sha: 'blob' }], comments: [], labels: [],
    permissions: { maintainer: 'write', visitor: 'read' }, actor: 'maintainer', calls: [],
    commit: { parents: [{ sha: BASE }, { sha: HEAD }], tree: { sha: TREE } },
  };
  const api = async (path, method = 'GET', body) => {
    state.calls.push({ path, method, body });
    const route = path.split('?')[0];
    if (route === '/pulls/42' && method === 'GET') return structuredClone(state.pr);
    if (route === '/pulls/42/files') return structuredClone(state.files);
    if (route === '/issues/42/comments' && method === 'GET') return structuredClone(state.comments);
    if (route === '/issues/42/comments' && method === 'POST') {
      state.comments.push(comment(null, 20, { body: body.body, user: { login: state.actor },
        ...(state.actor === 'github-actions[bot]' ? { performed_via_github_app: { slug: 'github-actions' } } : {}) }));
      return state.comments.at(-1);
    }
    if (route.startsWith('/collaborators/')) return { permission: state.permissions[decodeURIComponent(route.split('/')[2])] ?? 'none' };
    if (route === 'user') return { login: state.actor };
    if (route === '/issues/42/labels' && method === 'GET') return state.labels.map(name => ({ name }));
    if (route === '/labels' && method === 'GET') return [];
    if (route === '/labels' && method === 'POST') return body;
    if (route === '/issues/42/labels' && method === 'POST') { state.labels.push(...body.labels); return []; }
    if (route.startsWith('/issues/42/labels/') && method === 'DELETE') {
      state.labels = state.labels.filter(name => name !== decodeURIComponent(route.slice('/issues/42/labels/'.length))); return null;
    }
    if (route === 'graphql' && method === 'POST') { state.pr.draft = true; return {}; }
    if (route.startsWith('/git/commits/')) return structuredClone(state.commit);
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };
  const context = await readContext(api, 42);
  const decision = {
    schema_version: 1, ...catalog, pr_number: 42, head_sha: HEAD, base_sha: BASE, diff_fingerprint: context.diff_fingerprint,
    mode: 'selected', source: 'labeling', categories: [], reason: 'Documentation does not change runtime behavior.',
    evidence: [{ paths: context.paths, categories: [], reason: 'Reviewed the complete documentation diff.' }],
  };
  return { state, api, context, decision };
}

test('labels alone never authorize E2E', async () => {
  const f = await fixture(); f.state.labels = ['test:all-approved', 'test:selected', `test:${category}`];
  await assert.rejects(authorize(f.api, 42), /missing-collaborator-decision/);
});

test('unauthorized comments cannot approve or override a collaborator decision', async () => {
  const f = await fixture();
  f.state.comments = [comment(f.decision), comment({ ...f.decision, mode: 'triage' }, 11, { user: { login: 'visitor' } })];
  const result = await findDecision(f.api, f.context);
  assert.equal(result.valid, true); assert.equal(result.comment_id, 10);
  f.state.comments = [comment(f.decision, 12, { user: { login: 'visitor' } })];
  assert.equal((await findDecision(f.api, f.context)).valid, false);
});

for (const [name, newer, expected] of [
  ['edited', d => comment(d, 11, { updated_at: '2026-10-27T00:00:01Z' }), 'edited-or-malformed-decision'],
  ['malformed', () => comment(null, 11, { body: `${MARKER}\nnot json` }), 'edited-or-malformed-decision'],
  ['triage', d => comment({ ...d, mode: 'triage' }, 11), 'triage-requested'],
  ['stale', d => comment({ ...d, head_sha: 'e'.repeat(40) }, 11), 'missing-or-stale-decision'],
]) test(`latest trusted ${name} decision blocks older approval`, async () => {
  const f = await fixture(); f.state.comments = [newer(f.decision), comment(f.decision)];
  const result = await findDecision(f.api, f.context);
  assert.equal(result.valid, false); assert.equal(result.reason, expected); assert.equal(result.comment_id, 11);
});

test('decision validation binds head, base, complete diff and catalog', async () => {
  const f = await fixture(); assert.equal(validateDecision(f.decision, f.context).valid, true);
  for (const [patch, reason] of [
    [{ head_sha: 'e'.repeat(40) }, 'missing-or-stale-decision'],
    [{ base_sha: 'e'.repeat(40) }, 'missing-or-stale-decision'],
    [{ diff_fingerprint: 'different' }, 'changed-diff'],
    [{ policy_version: 'old' }, 'stale-policy-or-catalog'],
  ]) assert.equal(validateDecision({ ...f.decision, ...patch }, f.context).reason, reason);
});

test('full execution requires explicit triage source and explanation', async () => {
  const f = await fixture();
  assert.equal(validateDecision({ ...f.decision, mode: 'all' }, f.context).reason, 'full-needs-triage-approval');
  assert.equal(validateDecision({ ...f.decision, mode: 'all', source: 'triage', full_reason: ' ' }, f.context).valid, false);
  const full = { ...f.decision, mode: 'all', source: 'triage', full_reason: 'All rendering and persistence contracts changed.' };
  assert.equal(validateDecision(full, f.context).valid, true);
  assert.equal(validateDecision({ ...f.decision, categories: CATEGORIES.map(c => c.id) }, f.context).reason, 'all-categories-need-triage');
  f.state.comments = [comment(full)];
  const authorized = await authorize(f.api, 42);
  assert.equal(authorized.resolved.mode, 'all'); assert.equal(authorized.resolved.grep, '');
});

test('every changed path needs evidence and evidence may only name selected categories', async () => {
  const f = await fixture();
  assert.equal(validateDecision({ ...f.decision, evidence: [] }, f.context).reason, 'missing-path-evidence');
  assert.equal(validateDecision(f.decision, { ...f.context, paths: [...f.context.paths, 'src/extra.ts'] }).reason, 'unreviewed-path');
  assert.equal(validateDecision({ ...f.decision, evidence: [{ paths: ['unrelated'], categories: [], reason: 'Reviewed' }] }, f.context).reason, 'invalid-path-evidence');
  assert.equal(validateDecision({ ...f.decision, evidence: [{ ...f.decision.evidence[0], categories: [category] }] }, f.context).reason, 'evidence-category-not-selected');
});

test('incomplete file discovery rejects even an otherwise approved PR', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)]; f.state.pr.changed_files = 2;
  await assert.rejects(authorize(f.api, 42), /Incomplete changed-file discovery/);
});

test('renames require review evidence for both original and new paths', async () => {
  const f = await fixture();
  f.state.files = [{ filename: 'docs/new.md', previous_filename: 'docs/old.md', status: 'renamed', sha: 'blob' }];
  const context = await readContext(f.api, 42);
  assert.deepEqual(context.paths, ['docs/new.md', 'docs/old.md']);
  assert.deepEqual(context.removed_paths, ['docs/old.md']);
  const decision = { ...f.decision, diff_fingerprint: context.diff_fingerprint,
    evidence: [{ paths: ['docs/new.md'], categories: [], reason: 'Reviewed destination.' }] };
  assert.equal(validateDecision(decision, context).reason, 'unreviewed-path');
  decision.evidence[0].paths = context.paths;
  assert.equal(validateDecision(decision, context).valid, true);
});

test('removed and renamed original paths are stamped into the authorized selection', async () => {
  const f = await fixture(); f.state.pr.changed_files = 2;
  f.state.files = [
    { filename: 'docs/deleted.md', status: 'removed', sha: 'old-blob' },
    { filename: 'docs/new.md', previous_filename: 'docs/old.md', status: 'renamed', sha: 'new-blob' },
  ];
  const context = await readContext(f.api, 42);
  assert.deepEqual(context.removed_paths, ['docs/deleted.md', 'docs/old.md']);
  f.state.comments = [comment({ ...f.decision, diff_fingerprint: context.diff_fingerprint,
    evidence: [{ paths: context.paths, categories: [], reason: 'Reviewed removed and moved documentation.' }] })];
  const authorized = await authorize(f.api, 42);
  assert.deepEqual(authorized.selection.removed_paths, context.removed_paths);
});

test('authorization fails closed if collaborator permission cannot be verified', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)];
  const unavailable = (path, ...args) => {
    if (path.startsWith('/collaborators/')) throw new Error('GitHub unavailable');
    return f.api(path, ...args);
  };
  await assert.rejects(authorize(unavailable, 42), /collaborator-permission-unavailable/);
});

test('a push during authorization invalidates the result before dispatch', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)];
  const moving = (path, ...args) => {
    if (path.startsWith('/git/commits/')) f.state.pr.head.sha = 'e'.repeat(40);
    return f.api(path, ...args);
  };
  await assert.rejects(authorize(moving, 42), /PR advanced during authorization/);
});

test('smoke-only selected decision stays selected and is bound to tested merge tree', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)];
  const result = await authorize(f.api, 42);
  assert.equal(result.resolved.mode, 'selected'); assert.equal(result.resolved.grep, '@smoke');
  assert.equal(result.selection.head_sha, MERGE); assert.equal(result.selection.pr_head_sha, HEAD);
  assert.equal(result.selection.base_sha, BASE); assert.equal(result.selection.tested_tree, TREE);
  assert.deepEqual(result.selection.required, ['smoke']); assert.equal(result.selection.decision_id, 10);
});

test('authorization rejects wrong merge parents and arbitrary candidate commits', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)];
  for (const parents of [[HEAD], [HEAD, BASE], [BASE, 'e'.repeat(40)], [BASE, HEAD, TREE]]) {
    f.state.commit.parents = parents.map(sha => ({ sha }));
    await assert.rejects(authorize(f.api, 42, { candidate: 'f'.repeat(40) }), /stale or unrelated candidate/);
  }
  const directHead = await authorize(f.api, 42, { candidate: HEAD });
  assert.equal(directHead.candidate, HEAD);
});

test('child dispatch must retain expected decision, execution mode and exact grep', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)];
  for (const [options, error] of [
    [{ expectedDecision: 9 }, /decision superseded/],
    [{ expectedMode: 'all' }, /dispatch differs from decision/],
    [{ expectedGrep: '' }, /dispatch differs from decision/],
  ]) await assert.rejects(authorize(f.api, 42, options), error);
  const result = await authorize(f.api, 42, { expectedDecision: '10', expectedMode: 'selected', expectedGrep: '@smoke' });
  assert.equal(result.result.comment_id, 10);
});

test('synchronization replaces generated labels, preserves unrelated labels and returns unresolved PR to Draft', async () => {
  const f = await fixture(); f.state.pr.draft = false;
  f.state.labels = ['bug', 'test:jev-all', 'test:all', 'test:all-approved', 'test:selected', `test:${category}`];
  const result = await synchronize(f.api, f.context, { valid: false, reason: 'triage-requested' });
  assert.deepEqual(f.state.labels.sort(), ['bug', 'test:triage']); assert.equal(f.state.pr.draft, true);
  assert.equal(result.executable, false);
  const mutation = f.state.calls.find(c => c.path === 'graphql');
  assert.match(mutation.body.query, /convertPullRequestToDraft/); assert.equal(mutation.body.variables.id, 'PR_example');
});

test('a valid decision updates selected labels without automatically making a Draft Ready', async () => {
  const f = await fixture(); f.state.labels = ['test:triage', 'test:jev-all'];
  const result = await synchronize(f.api, f.context, { valid: true, decision: { ...f.decision, categories: [category] }, comment_id: 10 });
  assert.equal(result.executable, true); assert.deepEqual(f.state.labels.sort(), [`test:${category}`, 'test:selected'].sort());
  assert.equal(f.state.pr.draft, true); assert.equal(f.state.calls.some(c => c.path === 'graphql'), false);
});

test('synchronization does not mutate a PR that advanced since inspection', async () => {
  const f = await fixture(); f.state.pr.head.sha = 'e'.repeat(40);
  await assert.rejects(synchronize(f.api, f.context, { valid: false }), /PR changed before synchronization/);
  assert.equal(f.state.calls.some(c => c.method !== 'GET'), false);
});

test('publishing requires repository write access and refuses unauthorized full decisions', async () => {
  const f = await fixture(); f.state.actor = 'visitor';
  await assert.rejects(publish(f.api, f.context, f.decision), /repository write permission/);
  assert.equal(f.state.comments.length, 0);
  f.state.actor = 'maintainer';
  await assert.rejects(publish(f.api, f.context, { ...f.decision, mode: 'all' }), /full-needs-triage-approval/);
  assert.equal(f.state.comments.length, 0);
});

test('publishing creates an immutable collaborator decision with current catalog and syncs labels', async () => {
  const f = await fixture();
  const result = await publish(f.api, f.context, { ...f.decision, policy_version: 'caller-stale', diff_fingerprint: 'caller-stale' });
  assert.equal(result.executable, true); assert.equal(result.comment_id, 20);
  const found = await findDecision(f.api, f.context);
  assert.equal(found.valid, true); assert.equal(found.decision.policy_version, catalog.policy_version);
  assert.equal(found.decision.diff_fingerprint, f.context.diff_fingerprint);
  assert.equal(f.state.pr.draft, true);
});

test('publishing triage blocks execution and converts an existing Ready PR to Draft', async () => {
  const f = await fixture(); f.state.pr.draft = false;
  const result = await publish(f.api, f.context, { ...f.decision, mode: 'triage' });
  assert.equal(result.executable, false); assert.equal(result.mode, 'triage');
  assert.equal(f.state.pr.draft, true); assert.deepEqual(f.state.labels, ['test:triage']);
});

test('deleting a newer triage decision leaves a durable blocker instead of reviving old full approval', async () => {
  const f = await fixture();
  const full = { ...f.decision, mode: 'all', source: 'triage', full_reason: 'Shared behavior requires every suite.' };
  const deleted = comment({ ...f.decision, mode: 'triage' }, 11);
  f.state.comments = [comment(full)]; f.state.actor = 'github-actions[bot]';
  const event = { action: 'deleted', issue: { number: 42, pull_request: {} }, comment: deleted };
  assert.equal(await recordDeletedDecision(f.api, f.context, event, 'issue_comment'), true);
  const result = await findDecision(f.api, f.context);
  assert.equal(result.valid, false); assert.equal(result.reason, 'decision-deleted');
  await assert.rejects(authorize(f.api, 42), /decision-deleted/);
  await synchronize(f.api, f.context, result);
  assert.deepEqual(f.state.labels, ['test:triage']);
  assert.equal(await recordDeletedDecision(f.api, f.context, event, 'issue_comment'), false);
  assert.equal(f.state.comments.length, 2);
  f.state.comments.push(comment(f.decision, 21));
  assert.equal((await findDecision(f.api, f.context)).valid, true);
});

test('deleting a bot revocation creates another blocker rather than restoring an older approval', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)]; f.state.actor = 'github-actions[bot]';
  const deleted = comment({ ...f.decision, mode: 'triage', revoked_comment_id: 9 }, 11,
    { user: { login: 'github-actions[bot]' }, performed_via_github_app: { slug: 'github-actions' } });
  await recordDeletedDecision(f.api, f.context, { action: 'deleted', issue: { number: 42, pull_request: {} }, comment: deleted }, 'issue_comment');
  await assert.rejects(authorize(f.api, 42), /decision-deleted/);
});

test('controller provenance is required for bot blockers and a controller can never approve execution', async () => {
  const f = await fixture(); f.state.permissions['github-actions[bot]'] = 'none';
  const fake = comment({ ...f.decision, mode: 'triage' }, 11, { user: { login: 'github-actions[bot]' } });
  f.state.comments = [comment(f.decision), fake];
  assert.equal((await findDecision(f.api, f.context)).valid, true);
  for (const mode of ['selected', 'all']) {
    f.state.comments[1] = comment({ ...f.decision, mode, source: 'triage', full_reason: 'Cannot authorize as bot.' }, 11,
      { user: { login: 'github-actions[bot]' }, performed_via_github_app: { slug: 'github-actions' } });
    assert.equal((await findDecision(f.api, f.context)).valid, false);
    await assert.rejects(authorize(f.api, 42), /invalid-controller-decision/);
  }
});

test('unrelated webhook payloads do not create revocations', async () => {
  const f = await fixture();
  const event = { action: 'deleted', issue: { number: 42, pull_request: {} }, comment: comment(f.decision) };
  for (const [payload, name] of [
    [event, 'pull_request_target'], [{ ...event, action: 'created' }, 'issue_comment'],
    [{ ...event, issue: { number: 43, pull_request: {} } }, 'issue_comment'],
    [{ ...event, issue: { number: 42 } }, 'issue_comment'],
    [{ ...event, comment: { ...event.comment, body: 'Ordinary comment' } }, 'issue_comment'],
  ]) assert.equal(await recordDeletedDecision(f.api, f.context, payload, name), false);
  assert.equal(f.state.calls.some(c => c.method !== 'GET'), false);
});

test('outsider marker deletions cannot force a currently authorized PR back to triage', async () => {
  const f = await fixture(); f.state.comments = [comment(f.decision)];
  const event = { action: 'deleted', issue: { number: 42, pull_request: {} },
    comment: comment({ ...f.decision, mode: 'triage' }, 11, { user: { login: 'visitor' } }) };
  assert.equal(await recordDeletedDecision(f.api, f.context, event, 'issue_comment'), false);
  assert.equal(f.state.calls.some(c => c.method !== 'GET'), false);
  assert.equal((await findDecision(f.api, f.context)).valid, true);
});

test('deletions without verifiable author permission cannot write a blocker', async () => {
  const f = await fixture();
  const event = { action: 'deleted', issue: { number: 42, pull_request: {} }, comment: comment(f.decision) };
  const unavailable = (path, ...args) => {
    if (path.startsWith('/collaborators/')) throw new Error('Permission unavailable');
    return f.api(path, ...args);
  };
  assert.equal(await recordDeletedDecision(unavailable, f.context, event, 'issue_comment'), false);
  assert.equal(f.state.calls.some(c => c.method !== 'GET'), false);
});
