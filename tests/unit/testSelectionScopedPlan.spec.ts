import { describe, expect, it } from 'vitest';
import { createPlan } from '../../scripts/test-selection/plan.mjs';
import { scopedPlan } from '../../scripts/test-selection/scoped-plan.mjs';
import { resolveSelection } from '../../scripts/test-selection/resolve.mjs';
import { POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../e2e-tests/config/categories.mjs';
const selection = { schema_version: 1, head_sha: 'head', tested_tree: 'tree', category_version: CATEGORY_VERSION, policy_version: POLICY_VERSION, mode: 'selected', execution_mode: 'enabled', required: ['smoke'], diff_complete: true, request: { outcome: 'success', duration_ms: 42, usage: { input_tokens: 12, output_tokens: 8 } }, model: 'jev-test', categories: Object.fromEntries(CATEGORIES.map(c => [c.id, { probability: c.id === 'sequence' ? 0.8 : 0, selected: c.id === 'sequence' }])) };
const resolved = resolveSelection({ selection, files: ['src/export.js'], head: 'head', tree: 'tree' });
const specs = [['smoke', '@smoke', '@test:mermaid'], ['floor', '@export', '@test:cross-cutting'], ['jev', '@test:sequence'], ['unrelated', '@test:plantuml']].map(([id, ...tags]) => ({ id, file: id + '.spec.ts', title: id, tags: ['@variant:lite', ...tags], tests: [{ projectName: 'insert' }] }));
const discover = grep => ({ config: { projects: [{ name: 'insert', dependencies: ['auth'] }] }, suites: [{ title: 'tests', specs: specs.filter(s => !grep || new RegExp(grep).test([s.title, ...s.tags].join(' '))) }] });
const options = { discover, selection, resolved, head: 'head', tree: 'tree', policy: POLICY_VERSION, variant: 'lite', scope: 'insert', shards: 2, grep: resolved.grep };
describe('independent legacy ID floor', () => {
  it('unions concrete IDs, keeps smoke, and fingerprints the measured counts', () => {
    const plan = scopedPlan(options);
    expect(plan.tests.map(t => t.id).sort()).toEqual(['floor', 'jev', 'smoke']);
    expect(plan.selection_metrics).toMatchObject({ full_count: 4, legacy_count: 2, jev_count: 2, final_count: 3, smoke_count: 1, missing_floor_ids: [], retained_from_legacy_ids: ['floor'], added_to_legacy_ids: ['jev'] });
    expect(plan.dependencies).toEqual(['auth']);
    expect(plan.shards.flatMap(s => s.test_ids).sort()).toEqual(['floor', 'jev', 'smoke']);
  });
  it.each([null, { ...resolved, head_sha: 'stale' }, { ...resolved, tested_tree: 'stale' }, { ...resolved, policy_version: 'v2-guarded-uncalibrated' }, { ...resolved, deterministic_tags: [] }, { ...resolved, jev_categories: ['@test:missing'] }, { ...resolved, grep: '@smoke' }])('fails full for missing, stale or inconsistent resolved artifacts', artifact => {
    const plan = scopedPlan({ ...options, resolved: artifact });
    expect(plan.tests).toHaveLength(4);
    expect(plan.selection_metrics).toMatchObject({ mode: 'all', final_count: 4, jev_count: null, missing_floor_ids: [] });
  });
  it('does not narrow an explicit full request even when selected artifacts are present', () => {
    expect(scopedPlan({ ...options, grep: '' }).tests).toHaveLength(4);
  });
  it.each([{ ...selection, schema_version: 2 }, { ...selection, diff_complete: false }, { ...selection, required: [] }, { ...selection, categories: { ...selection.categories, sequence: { probability: 0, selected: true } } }])('fails full for malformed raw decision', raw => {
    expect(scopedPlan({ ...options, selection: raw }).tests).toHaveLength(4);
  });
  it('fails full without crashing for malformed reason or floor metadata', () => {
    for (const artifact of [{ ...resolved, reasons: {} }, { ...resolved, deterministic_tags: ['@smoke', {}] }]) {
      expect(scopedPlan({ ...options, resolved: artifact }).tests).toHaveLength(4);
    }
  });
  it('retains an incompletely tagged full inventory instead of allowing ID selection to bypass fail-full', () => {
    const incomplete = discover('');
    incomplete.suites[0].specs = incomplete.suites[0].specs.map(s => s.id === 'unrelated' ? { ...s, tags: ['@variant:lite'] } : s);
    const plan = scopedPlan({ ...options, discover: () => incomplete });
    expect(plan.tests).toHaveLength(4);
    expect(plan.selection_metrics.fallback_reason).toBe('incomplete-inventory');
    expect(createPlan({ selection, discovery: incomplete, variant: 'lite', tree: 'tree', policy: POLICY_VERSION, scope: 'insert', testIds: ['smoke'] }).tests).toHaveLength(4);
  });
  it('fails full for old policy or failed raw classifier even with a matching resolved artifact', () => {
    for (const raw of [{ ...selection, policy_version: 'v2-guarded-uncalibrated' }, { ...selection, request: { outcome: 'failed' } }, { ...selection, fallback_reason: 'api-http-error' }]) {
      expect(scopedPlan({ ...options, selection: raw }).tests).toHaveLength(4);
    }
  });
});
