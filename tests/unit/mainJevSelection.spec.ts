import { describe, it, expect } from 'vitest';
import { classify, POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
import { resolveSelection } from '../../scripts/test-selection/resolve.mjs';
import { scopedPlan } from '../../scripts/test-selection/scoped-plan.mjs';
import { CATEGORIES } from '../e2e-tests/config/categories.mjs';
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
const diff = { base_sha: 'c'.repeat(40), head_sha: head, tested_tree: tree, paths: ['src/model/Diagram/Diagram.ts', 'functions/new-handler.ts'], changes: [], complete: true, diff: 'public application diff' };
const selected = CATEGORIES[0].id;
const fakeResponse = (p = 0.02, category: string | null = null) => async () => new Response(JSON.stringify({ model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 1 }, answers: Object.fromEntries(CATEGORIES.map(c => [c.id, { type: 'noul', noul: c.id === category ? 0.9 : p }])) }));
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
  it.each(['.github/workflows/build-test-deploy.yml', 'scripts/test-selection/resolve.mjs', 'tests/e2e-tests/config/categories.mjs'])('runs full when the decision boundary changes: %s', async path => {
    const s = await classifyMain({ diff: { ...diff, paths: [path] }, fetchImpl: () => { throw new Error('must not transmit'); } });
    expect(s.fallback_reason).toBe('selection-infrastructure-path');
    expect(resolved(s, [path]).mode).toBe('all');
  });
  it('accepts explicit low-probability no-impact results and retains smoke', async () => {
    const s = await classifyMain();
    expect(s.no_additional_impact).toBe(true);
    expect(resolved(s).grep).toBe('@smoke');
    expect(plan(s).tests.map(t => t.id)).toEqual(['smoke']);
  });
  it('does not treat ambiguity or API errors as no impact', async () => {
    expect((await classifyMain({ fetchImpl: fakeResponse(0.5) })).fallback_reason).toBe('uncertain-empty-selection');
    expect((await classifyMain({ fetchImpl: async () => new Response('', { status: 503 }) })).mode).toBe('all');
    const s = await classifyMain();
    s.categories[selected].probability = 0.5;
    expect(resolved(s).mode).toBe('all');
  });
  it.each(['lite', 'full', 'diagramly', 'asyncapi'])('selects syntax tests from full inventory for %s', async variant => {
    const s = await classifyMain({ fetchImpl: fakeResponse(0.02, selected) });
    expect(plan(s, variant).tests.map(t => t.id).sort()).toEqual(['impact', 'smoke']);
  });
  it('requires full coverage for helpers whose dependent specs are not proven', async () => {
    const s = await classifyMain();
    const files = ['tests/e2e-tests/helpers/CopyForAiHelper.ts'];
    expect(resolved(s, files).mode).toBe('all');
    const classified = await classifyMain({ diff: { ...diff, paths: files } });
    expect(classified.fallback_reason).toBe('selection-infrastructure-path');
  });
  it('retains a directly modified test when Jev reports no extra impact', async () => {
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
