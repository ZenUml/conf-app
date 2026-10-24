#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CATEGORIES, CATEGORY_VERSION } from '../../tests/e2e-tests/config/categories.mjs';
import { args } from './classify.mjs';
export async function publishLabels({ selection, repo, pr, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(String(pr)) || !token) throw new Error('Invalid label configuration');
  const ids = new Set(CATEGORIES.map(c => c.id));
  if (selection.schema_version !== 1 || selection.category_version !== CATEGORY_VERSION || !/^[a-f0-9]{40}$/.test(selection.head_sha) || !['all', 'selected'].includes(selection.mode)) throw new Error('Invalid selection');
  if (Object.keys(selection.categories).some(id => !ids.has(id))) throw new Error('Unknown category');
  const api = async (path, method = 'GET', body) => {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, { method, signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`); return r.status === 204 ? null : r.json();
  };
  const current = await api(`/pulls/${pr}`);
  if (current.head.sha !== (selection.pr_head_sha ?? selection.head_sha)) return { outcome: 'stale', added: [], removed: [] };
  const existing = await api(`/issues/${pr}/labels?per_page=100`);
  const generated = new Set([...ids].map(id => `test:${id}`)); generated.add('test:jev-all');
  const desired = selection.mode === 'all' ? ['test:jev-all'] : Object.entries(selection.categories).filter(([, c]) => c.selected === true).map(([id]) => `test:${id}`);
  for (const name of desired) {
    // Repository labels are created idempotently; a 422 means the label already exists.
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/labels`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color: 'bfdadc', description: 'Generated Jev test selection proposal' }) });
    if (!r.ok && r.status !== 422) throw new Error(`GitHub HTTP ${r.status}`);
  }
  // Re-check after label preparation, before changing the PR display.
  if ((await api(`/pulls/${pr}`)).head.sha !== (selection.pr_head_sha ?? selection.head_sha)) return { outcome: 'stale', added: [], removed: [] };
  const removed = existing.map(l => l.name).filter(name => generated.has(name) && !desired.includes(name));
  if (desired.length) await api(`/issues/${pr}/labels`, 'POST', { labels: desired });
  for (const name of removed) await api(`/issues/${pr}/labels/${encodeURIComponent(name)}`, 'DELETE');
  return { outcome: 'published', added: desired, removed };
}
async function main() { const a = args(process.argv.slice(2)); const result = await publishLabels({ selection: JSON.parse(readFileSync(a.selection, 'utf8')), repo: a.repo, pr: a.pr, token: process.env.GH_TOKEN }); console.log(JSON.stringify(result)); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Label publication failed'); process.exitCode = 1; });
