import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPrE2E } from '../request-pr-e2e.mjs';
import { MARKER, catalog, readContext } from '../pr-decision.mjs';

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), MERGE = 'c'.repeat(40), TREE = 'd'.repeat(40);
async function fixture({ existingRunLabel = false, repoLabelExists = true } = {}) {
  const state = {
    pr: { number: 42, state: 'open', draft: true, changed_files: 1, head: { sha: HEAD }, base: { sha: BASE }, merge_commit_sha: MERGE },
    files: [{ filename: 'docs/guide.md', status: 'modified', sha: 'blob' }], comments: [], calls: [],
    labels: ['bug', 'test:selected', ...(existingRunLabel ? ['test:run'] : [])], repoLabelExists,
    afterPreparation: null,
  };
  const api = async (path, method = 'GET', body) => {
    state.calls.push({ path, method, body });
    const route = path.split('?')[0];
    if (route === '/pulls/42') return structuredClone(state.pr);
    if (route === '/pulls/42/files') return structuredClone(state.files);
    if (route === '/issues/42/comments') return structuredClone(state.comments);
    if (route === '/collaborators/maintainer/permission') return { permission: 'write' };
    if (route.startsWith('/git/commits/')) return { parents: [{ sha: BASE }, { sha: HEAD }], tree: { sha: TREE } };
    if (route === '/labels' && method === 'GET') return state.repoLabelExists ? [{ name: 'test:run' }] : [];
    if (route === '/labels' && method === 'POST') { state.repoLabelExists = true; return body; }
    if (route === '/issues/42/labels' && method === 'GET') {
      const labels = state.labels.map(name => ({ name })); state.afterPreparation?.(); return labels;
    }
    if (route === '/issues/42/labels/test%3Arun' && method === 'DELETE') {
      state.labels = state.labels.filter(name => name !== 'test:run'); return null;
    }
    if (route === '/issues/42/labels' && method === 'POST') { state.labels.push(...body.labels); return []; }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };
  const context = await readContext(api, 42);
  const decision = {
    schema_version: 1, ...catalog, pr_number: 42, head_sha: HEAD, base_sha: BASE, diff_fingerprint: context.diff_fingerprint,
    mode: 'selected', source: 'labeling', categories: [], reason: 'Documentation only; smoke is sufficient.',
    evidence: [{ paths: context.paths, categories: [], reason: 'Reviewed the complete documentation change.' }],
  };
  const makeComment = (id, value) => ({ id, user: { login: 'maintainer' },
    body: `${MARKER}\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z' });
  state.comments = [makeComment(10, decision)]; state.calls = [];
  return { state, api, decision, makeComment };
}

test('an approved smoke-only decision requests E2E while keeping Draft and other labels', async () => {
  const f = await fixture();
  const result = await requestPrE2E(f.api, 42);
  assert.deepEqual(result, { requested: true, pr_number: 42, head_sha: HEAD, candidate: MERGE, decision_id: 10 });
  assert.deepEqual(f.state.labels, ['bug', 'test:selected', 'test:run']);
  assert.equal(f.state.pr.draft, true);
  const writes = f.state.calls.filter(call => call.method !== 'GET');
  assert.deepEqual(writes, [{ path: '/issues/42/labels', method: 'POST', body: { labels: ['test:run'] } }]);
  const firstLabelRead = f.state.calls.findIndex(c => c.path.startsWith('/labels'));
  assert.ok(f.state.calls.slice(0, firstLabelRead).some(c => c.path === '/git/commits/' + MERGE));
});

test('a repeated request toggles only test:run and reauthorizes before adding it', async () => {
  const f = await fixture({ existingRunLabel: true });
  await requestPrE2E(f.api, 42);
  const writes = f.state.calls.filter(c => c.method !== 'GET');
  assert.deepEqual(writes, [
    { path: '/issues/42/labels/test%3Arun', method: 'DELETE', body: undefined },
    { path: '/issues/42/labels', method: 'POST', body: { labels: ['test:run'] } },
  ]);
  const removal = f.state.calls.findIndex(c => c.method === 'DELETE');
  const addition = f.state.calls.findIndex(c => c.method === 'POST');
  assert.ok(f.state.calls.slice(removal + 1, addition).some(c => c.path === '/issues/42/comments?per_page=100&page=1'));
  assert.deepEqual(f.state.labels, ['bug', 'test:selected', 'test:run']);
});

test('missing approval prevents all request label reads and writes', async () => {
  const f = await fixture(); f.state.comments = [];
  await assert.rejects(requestPrE2E(f.api, 42), /missing-collaborator-decision/);
  assert.equal(f.state.calls.some(c => c.method !== 'GET'), false);
  assert.equal(f.state.calls.some(c => c.path.includes('/labels')), false);
});

test('a push during label preparation blocks the request before test:run is added', async () => {
  const f = await fixture(); f.state.afterPreparation = () => { f.state.pr.head.sha = 'e'.repeat(40); };
  await assert.rejects(requestPrE2E(f.api, 42), /missing-or-stale-decision/);
  assert.equal(f.state.calls.some(c => c.method === 'POST' && c.path === '/issues/42/labels'), false);
  assert.equal(f.state.labels.includes('test:run'), false);
});

test('a superseding approval during preparation requires a fresh request', async () => {
  const f = await fixture();
  f.state.afterPreparation = () => f.state.comments.push(f.makeComment(11, f.decision));
  await assert.rejects(requestPrE2E(f.api, 42), /decision superseded/);
  assert.equal(f.state.calls.some(c => c.method !== 'GET'), false);
});

test('triage posted during preparation prevents request even after an old request label was removed', async () => {
  const f = await fixture({ existingRunLabel: true });
  f.state.afterPreparation = () => f.state.comments.push(f.makeComment(11, { ...f.decision, mode: 'triage' }));
  await assert.rejects(requestPrE2E(f.api, 42), /triage-requested/);
  assert.deepEqual(f.state.calls.filter(c => c.method !== 'GET').map(c => [c.method, c.path]), [['DELETE', '/issues/42/labels/test%3Arun']]);
  assert.deepEqual(f.state.labels, ['bug', 'test:selected']);
});

test('request creates its dedicated repository label only after current approval was verified', async () => {
  const f = await fixture({ repoLabelExists: false });
  await requestPrE2E(f.api, 42);
  const created = f.state.calls.findIndex(c => c.method === 'POST' && c.path === '/labels');
  assert.ok(created >= 0);
  assert.equal(f.state.calls[created].body.name, 'test:run');
  assert.ok(f.state.calls.slice(0, created).some(c => c.path.startsWith('/git/commits/')));
  assert.deepEqual(f.state.labels, ['bug', 'test:selected', 'test:run']);
});
