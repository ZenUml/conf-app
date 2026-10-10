import { describe, it, expect, vi } from 'vitest';
import { classify, pathRule, POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
import { resolveSelection } from '../../scripts/test-selection/resolve.mjs';
import { select } from '../../scripts/e2e-select.mjs';
import { scopedPlan } from '../../scripts/test-selection/scoped-plan.mjs';
import { CATEGORIES } from '../e2e-tests/config/categories.mjs';
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
const diff = { base_sha: 'c'.repeat(40), head_sha: head, tested_tree: tree, paths: ['src/model/Diagram/Diagram.ts', 'functions/new-handler.ts'], changes: [], complete: true, diff: 'public application diff' };
const selected = CATEGORIES[0].id;
const fakeResponse = (p = 0.02, category: string | null = null) => async (_url: string, _init: any) => new Response(JSON.stringify({ model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 1 }, answers: Object.fromEntries(CATEGORIES.map(c => [c.id, { type: 'noul', noul: c.id === category ? 0.9 : p }])) }));
const classifyMain = (extra = {}) => classify({ diff, apiKey: 'fake', scope: 'main', mode: 'enabled', fetchImpl: fakeResponse(), ...extra });
const discovery = (variant: string, render = false) => ({ suites: [{ title: 'tests', specs: [
  ...(!render ? [{ id: 'smoke', file: 'insert/smoke.spec.ts', title: 'smoke', tags: ['@smoke', `@variant:${variant}`, `@test:${CATEGORIES[1].id}`], tests: [{ projectName: 'insert' }] }] : []),
  { id: 'impact', file: `${render ? 'render' : 'syntax-validation'}/impact.spec.ts`, title: 'impact', tags: [`@variant:${variant}`, `@test:${selected}`], tests: [{ projectName: render ? 'render' : 'syntax-validation' }] },
  { id: 'unrelated', file: `${render ? 'render' : 'agent-link'}/unrelated.spec.ts`, title: 'unrelated', tags: [`@variant:${variant}`, `@test:${CATEGORIES[1].id}`], tests: [{ projectName: render ? 'render' : 'agent-link' }] },
] }] });
const resolved = (selection: any, files = diff.paths) => resolveSelection({ selection, files, head, tree, scope: 'main' });
const plan = (selection: any, variant = 'lite', render = false, files = diff.paths) => {
  const r = resolved(selection, files);
  return scopedPlan({ discover: () => discovery(variant, render), selection, resolved: r, head, tree, policy: POLICY_VERSION, variant, selectionScope: 'main', scope: render ? 'render' : 'all', shards: 4, grep: r.grep });
};
describe('main Jev behavior selection', () => {
  it('classifies shared and unmapped application paths while PR policy stays conservative', async () => {
    const s = await classifyMain({ diff: { ...diff, paths: [...diff.paths, 'unmapped/file'] }, fetchImpl: fakeResponse(0.02, selected) });
    expect(s.mode).toBe('selected');
    expect(resolved(s).tags).toEqual(['@smoke', `@test:${selected}`].sort());
    expect((await classify({ diff, apiKey: 'fake', fetchImpl: fakeResponse() })).fallback_reason).toBe('shared-path');
  });
  it.each([
    '.github/workflows/build-test-deploy.yml',
    '.github/actions/wrangler-publish/action.yml',
    'scripts/ci/wait-for-e2e.mjs',
    'scripts/test-selection/resolve.mjs',
    'scripts/e2e-select.mjs',
    'tests/e2e-tests/config/categories.mjs',
    'tests/e2e-tests/playwright.config.ts',
    'tests/e2e-tests/globalSetup.ts',
    'tests/e2e-tests/helpers/CopyForAiHelper.ts',
  ])('asks Jev about main infrastructure changes and retains smoke: %s', async path => {
    const infrastructureDiff = { ...diff, paths: [path], diff: `public diff for ${path}` };
    const fetchImpl = vi.fn(fakeResponse());
    const s = await classifyMain({ diff: infrastructureDiff, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).state.diff).toBe(infrastructureDiff.diff);
    expect(s.request.outcome).toBe('success');
    expect(s.fallback_reason).toBeNull();
    expect(pathRule(path, 'main')).toBeNull();
    expect(select([path], { scope: 'main' })).toMatchObject({ mode: 'selected', tags: ['@smoke'] });
    expect(resolved(s, [path])).toMatchObject({ mode: 'selected', grep: '@smoke' });
    expect(plan(s, 'lite', false, [path]).tests.map(t => t.id)).toEqual(['smoke']);
    expect(pathRule(path, 'pr')).not.toBeNull();
  });
  it('adds the behavior Jev identifies in an infrastructure diff', async () => {
    const files = ['.github/workflows/main-staging-validation.yml', 'scripts/ci/wait-for-e2e.mjs'];
    const fetchImpl = vi.fn(fakeResponse(0.02, selected));
    const s = await classifyMain({ diff: { ...diff, paths: files }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(resolved(s, files).tags).toEqual(['@smoke', `@test:${selected}`].sort());
    expect(plan(s, 'lite', false, files).tests.map(t => t.id).sort()).toEqual(['impact', 'smoke']);
  });
  it('preserves PR infrastructure full coverage without making an API request', async () => {
    const files = ['.github/workflows/main-staging-validation.yml', 'scripts/ci/wait-for-e2e.mjs'];
    const fetchImpl = vi.fn(fakeResponse());
    const s = await classify({ diff: { ...diff, paths: files }, apiKey: 'fake', mode: 'enabled', fetchImpl });
    expect(s.fallback_reason).toBe('shared-path');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(select(files).mode).toBe('all');
  });
  it('keeps non-path full fallbacks for infrastructure changes', async () => {
    const infrastructureDiff = { ...diff, paths: ['scripts/ci/wait-for-e2e.mjs'] };
    for (const [extra, reason] of [
      [{ humanFull: true }, 'human-test-all'],
      [{ apiKey: '' }, 'missing-api-key'],
      [{ diff: { ...infrastructureDiff, complete: false } }, 'incomplete-diff'],
      [{ diff: { ...infrastructureDiff, paths: ['private/report.md'] } }, 'excluded-sensitive-path'],
      [{ diff: { ...infrastructureDiff, diff: 'https://example-tenant.atlassian.net/wiki' } }, 'potential-sensitive-diff'],
    ] as const) {
      const fetchImpl = vi.fn(fakeResponse());
      const s = await classifyMain({ diff: infrastructureDiff, fetchImpl, ...extra });
      expect(s.fallback_reason).toBe(reason);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(resolved(s, infrastructureDiff.paths).mode).toBe('all');
    }
    const failed = await classifyMain({ diff: infrastructureDiff, fetchImpl: async () => new Response('', { status: 503 }) });
    expect(failed.fallback_reason).toBe('api-http-error');
    expect(resolved(failed, infrastructureDiff.paths).mode).toBe('all');
    const missing = resolved(null, infrastructureDiff.paths);
    expect(missing.mode).toBe('all');
  });
  it('rejects decisions authorized by the previous main policy', async () => {
    const s = await classifyMain();
    expect(POLICY_VERSION).not.toBe('v8-main-jev-infrastructure-v1');
    const r = resolved({ ...s, policy_version: 'v8-main-jev-infrastructure-v1' }, ['scripts/ci/wait-for-e2e.mjs']);
    expect(r).toMatchObject({ mode: 'all', reasons: ['invalid-or-stale-jev-selection'] });
  });
  it.each([0.02, 0.1, 0.32, 0.799])('runs the floor when main probabilities stay below 0.8: %s', async probability => {
    const s = await classifyMain({ fetchImpl: fakeResponse(probability) });
    expect(s).toMatchObject({ mode: 'selected', execution_mode: 'enabled', fallback_reason: null, no_selected_categories: true });
    expect(s).not.toHaveProperty('no_additional_impact');
    expect(s.rules).toContain('jev-no-selected-categories');
    expect(resolved(s).grep).toBe('@smoke');
    expect(plan(s).tests.map(t => t.id)).toEqual(['smoke']);
    expect(plan(s, 'lite', true).tests).toEqual([]);
    expect(resolved({ ...s, no_selected_categories: undefined }).mode).toBe('selected');
  });
  it('selects at 0.8 and preserves direct specs with mixed lower probabilities', async () => {
    const files = ['tests/e2e-tests/tests/agent-link/unrelated.spec.ts'];
    const s = await classifyMain({ diff: { ...diff, paths: files }, fetchImpl: async () => new Response(JSON.stringify({
      model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 1 },
      answers: Object.fromEntries(CATEGORIES.map(c => [c.id, { type: 'noul', noul: c.id === selected ? 0.8 : 0.32 }])),
    })) });
    expect(s.categories[selected]).toMatchObject({ probability: 0.8, selected: true });
    expect(s.categories[CATEGORIES[1].id]).toMatchObject({ probability: 0.32, selected: false });
    expect(resolved(s, files).jev_categories).toEqual([`@test:${selected}`]);
    expect(plan(s, 'lite', false, files).tests.map(t => t.id).sort()).toEqual(['impact', 'smoke', 'unrelated']);
    const below = await classifyMain({ fetchImpl: fakeResponse(0.799) });
    expect(plan(below, 'lite', false, files).tests.map(t => t.id).sort()).toEqual(['smoke', 'unrelated']);
  });
  it.each([0.1, 0.32, 0.799])('keeps PR empty-selection fallback at probability %s', async probability => {
    const files = ['src/components/Mermaid.vue'];
    const s = await classify({ diff: { ...diff, paths: files }, apiKey: 'fake', mode: 'enabled', fetchImpl: fakeResponse(probability) });
    expect(s).toMatchObject({ mode: 'all', fallback_reason: 'empty-selection' });
    expect(resolveSelection({ selection: { ...s, mode: 'selected', execution_mode: 'enabled', fallback_reason: null }, files, head, tree }).mode).toBe('all');
  });
  it('keeps API failures and inconsistent category decisions on full coverage', async () => {
    expect((await classifyMain({ fetchImpl: async () => new Response('', { status: 503 }) })).mode).toBe('all');
    const s = await classifyMain();
    s.categories[selected] = { probability: 0.5, selected: true, uncertain: true };
    expect(resolved(s).mode).toBe('all');
  });
  it.each(['lite', 'full', 'diagramly', 'asyncapi'])('selects syntax tests from full inventory for %s', async variant => {
    const s = await classifyMain({ fetchImpl: fakeResponse(0.02, selected) });
    expect(plan(s, variant).tests.map(t => t.id).sort()).toEqual(['impact', 'smoke']);
  });
  it('retains a directly modified test when Jev selects no categories', async () => {
    const s = await classifyMain();
    expect(plan(s, 'lite', false, ['tests/e2e-tests/tests/agent-link/unrelated.spec.ts']).tests.map(t => t.id).sort()).toEqual(['smoke', 'unrelated']);
  });
  it('allows an empty render plan only with a verified main decision', async () => {
    const s = await classifyMain();
    expect(plan(s, 'lite', true).shards).toEqual([]);
    expect(plan(s, 'lite', true).tests).toEqual([]);
    expect(plan({ ...s, tested_tree: 'stale' }, 'lite', true).tests).toHaveLength(2);
  });
  it('rejects PR decisions used as main authorization and preserves manual full', async () => {
    const s = await classifyMain({ fetchImpl: fakeResponse(0.02, selected) });
    expect(resolved({ ...s, selection_scope: 'pr' }).mode).toBe('all');
    expect(resolveSelection({ selection: s, files: diff.paths, head, tree, scope: 'main', humanFull: true }).mode).toBe('all');
  });
});
