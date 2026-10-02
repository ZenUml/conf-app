import { describe, it, expect } from 'vitest';
import { classify, pathRule } from '../../scripts/test-selection/classify.mjs';
import { CATEGORIES } from '../e2e-tests/config/categories.mjs';
import { publishLabels } from '../../scripts/test-selection/labels.mjs';
import { evaluate } from '../../scripts/test-selection/replay.mjs';
const diff = { base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), tested_tree: 'c'.repeat(40), paths: ['src/components/Mermaid.vue'], changes: [], complete: true, diff: 'public diff' };
const body = (probability = 0.02) => ({ model: 'jev-1.13.0', usage: { input_tokens: 12, output_tokens: 5 }, answers: Object.fromEntries(CATEGORIES.map(c => [c.id, { type: 'noul', noul: probability }])) });
const response = (b: any) => async () => new Response(JSON.stringify(b), { status: 200 });
describe('Jev conservative classification', () => {
  it('selects uncertain categories, but observation never narrows execution', async () => { const r = await classify({ diff, apiKey: 'fake', fetchImpl: response(body(0.4)) }); expect(r.mode).toBe('selected'); expect(r.execution_mode).toBe('observe'); expect(Object.values(r.categories).every((c: any) => c.selected && c.uncertain)).toBe(true); });
  it('does not enable uncalibrated narrowing', async () => { const r = await classify({ diff, apiKey: 'fake', mode: 'enabled', fetchImpl: response(body(0.9)) }); expect(r.execution_mode).toBe('all'); expect(r.rules).toContain('uncalibrated-policy-full-execution'); });
  it.each([
    [{ ...diff, complete: false }, 'key', false, 'incomplete-diff'],
    [{ ...diff, paths: ['mystery/file'] }, 'key', false, 'unknown-path'],
    [{ ...diff, paths: ['manifest.yml'] }, 'key', false, 'shared-path'],
    [{ ...diff, paths: ['private/report.md'] }, 'key', false, 'excluded-sensitive-path'],
    [diff, '', false, 'missing-api-key'], [diff, 'key', true, 'human-test-all'],
  ])('fails closed for deterministic rules', async (d, key, full, reason) => { const r = await classify({ diff: d, apiKey: key, humanFull: full, fetchImpl: () => { throw new Error('must not call'); } }); expect(r.mode).toBe('all'); expect(r.fallback_reason).toBe(reason); });
  it.each([{}, { ...body(), answers: {} }, { ...body(), answers: Object.fromEntries(CATEGORIES.map(c => [c.id, { type: 'noul', noul: 2 }])) }])('rejects malformed or incomplete answers', async b => { expect((await classify({ diff, apiKey: 'fake', fetchImpl: response(b) })).fallback_reason).toBe('api-invalid-or-timeout'); });
  it('does not transmit likely customer or credential data', async () => { const r = await classify({ diff: { ...diff, diff: 'https://customer.atlassian.net/wiki' }, apiKey: 'fake', fetchImpl: () => { throw new Error('must not transmit'); } }); expect(r.fallback_reason).toBe('potential-sensitive-diff'); });
  it('handles API rejection and timeout', async () => { expect((await classify({ diff, apiKey: 'fake', fetchImpl: async () => new Response('', { status: 401 }) })).fallback_reason).toBe('api-http-error'); expect((await classify({ diff, apiKey: 'fake', fetchImpl: async () => { throw new Error('abort'); } })).mode).toBe('all'); });
  it('checks renamed old paths and deleted paths conservatively', async () => { const r = await classify({ diff: { ...diff, paths: ['src/model/old.ts', 'src/components/new.vue'], changes: [{ status: 'R100', path: 'src/components/new.vue', old_path: 'src/model/old.ts' }] }, apiKey: 'fake' }); expect(r.fallback_reason).toBe('shared-path'); expect(pathRule('src/model/deleted.ts')).toBe('shared-path'); });
});
describe('trusted label publisher', () => {
  const selection = { schema_version: 1, category_version: '', head_sha: diff.head_sha, mode: 'selected', categories: {} };
  it('rejects stale heads before mutations', async () => { const { CATEGORY_VERSION } = await import('../e2e-tests/config/categories.mjs'); let calls = 0; const r = await publishLabels({ selection: { ...selection, category_version: CATEGORY_VERSION }, repo: 'ZenUml/conf-app', pr: 1, token: 'fake', fetchImpl: async () => { calls++; return new Response(JSON.stringify({ head: { sha: 'd'.repeat(40) } })); } }); expect(r.outcome).toBe('stale'); expect(calls).toBe(1); });
  it('preserves test:all and unrelated labels', async () => { const { CATEGORY_VERSION } = await import('../e2e-tests/config/categories.mjs'); const calls: any[] = []; await publishLabels({ selection: { ...selection, mode: 'all', category_version: CATEGORY_VERSION }, repo: 'ZenUml/conf-app', pr: 1, token: 'fake', fetchImpl: async (url: string, opts: any) => { calls.push([url, opts.method]); if (url.includes('/pulls/')) return new Response(JSON.stringify({ head: { sha: diff.head_sha } })); if (opts.method === 'GET') return new Response(JSON.stringify([{ name: 'test:all' }, { name: 'bug' }, { name: `test:${CATEGORIES[0].id}` }])); return new Response('{}'); } }); expect(calls.filter(c => c[1] === 'DELETE').every(c => !c[0].includes('test%3Aall') && !c[0].endsWith('/bug'))).toBe(true); });
});
describe('reviewed historical replay', () => {
  it('records misses and actual duration inputs without claiming calibration', () => { const r = evaluate({ mode: 'selected', categories: { one: { selected: true } } }, { id: 'review', reviewed_by: 'reviewer', expected_categories: ['one', 'two'], tests: [{ id: 't1', categories: ['one'], duration_ms: 500 }, { id: 't2', categories: ['two'], duration_ms: 900 }] }); expect(r.misses).toEqual(['two']); expect(r.missed_test_ids).toEqual(['t2']); expect(r.estimated_selected_duration_ms).toBe(500); expect(r.calibration).toBe('not-established'); });
  it('requires reviewed expectations', () => expect(() => evaluate({}, { expected_categories: [] })).toThrow());
});
