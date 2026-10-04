import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateReuse } from '../../scripts/test-selection/reuse.mjs';
import { createPlan } from '../../scripts/test-selection/plan.mjs';
import { createEvidence } from '../../scripts/test-selection/evidence.mjs';
import { CATEGORY_VERSION, CATEGORIES } from '../e2e-tests/config/categories.mjs';
import { POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
const workflow = (name: string) => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
describe('staging workflow safety contracts', () => {
  it('holds queued staging ownership through parent deploy/test runs without nested same-group locks', () => {
    for (const name of ['build-test-deploy', 'daily-regression']) { const yaml = workflow(name); expect(yaml).toMatch(/concurrency:\n  group: conf-app-staging\n  cancel-in-progress: false\n  queue: max/); }
    expect(workflow('staging-deploy')).toContain("github.workflow == 'Staging Deploy' && 'conf-app-staging'");
    expect(workflow('staging-transaction')).not.toContain('concurrency:');
  });
  it('runs dependency-free aggregation without requiring a pnpm executable', () => { const evidenceJob = workflow('e2e-test').split('  evidence:')[1].split('  merge-reports:')[0]; expect(evidenceJob).toContain('package-manager-cache: false'); for (const name of ['daily-regression', 'test-selection-labels']) expect(workflow(name)).toContain('package-manager-cache: false'); });
  it('keeps classification and privileged publication on trusted code', () => {
    expect(workflow('build-test-deploy')).toContain('ref: ${{ github.event.pull_request.base.sha || github.sha }}');
    expect(workflow('build-test-deploy')).toContain('--mode enabled');
    expect(workflow('test-selection-labels')).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow('test-all-override')).not.toContain('actions/checkout');
    expect(workflow('test-all-override')).toContain('"force-all":"true"');
  });
  it('preserves manual full coverage and succeeds with legitimate skips while rejecting reuse', () => {
    const yaml = workflow('build-test-deploy'); expect(yaml).toContain("contains(github.event.pull_request.labels.*.name, 'test:all')"); expect(yaml).toContain('Human test:all override: full E2E coverage');
    expect(workflow('e2e-test')).toContain('if(!e.execution_succeeded) process.exit(1)');
    expect(workflow('daily-regression')).toContain("cron: '0 2 * * *'");
    expect(workflow('staging-transaction')).toContain('ref: ${{ inputs.ref }}');
    expect(workflow('staging-transaction')).toContain('suite: regression'); expect(workflow('staging-transaction')).not.toContain("if: inputs.variant != 'asyncapi'"); expect(workflow('staging-transaction')).toContain('suite: regression-render');
    expect(workflow('daily-regression')).not.toContain('SLACK_BOT_TOKEN');
  });
});
describe('exact-tree reuse validation', () => {
  const tree = 'tree';
  const discovery = { config: { projects: [{ name: 'insert', dependencies: ['auth'] }] }, suites: [{ title: 'tests', file: 'insert/plantuml.spec.ts', specs: [{ id: 'test-one', title: 'renders', file: 'insert/plantuml.spec.ts', tags: ['@smoke', '@variant:lite', `@test:${CATEGORIES[0].id}`], tests: [{ projectName: 'insert' }] }] }] };
  const plan = createPlan({ selection: { schema_version: 1, tested_tree: tree, category_version: CATEGORY_VERSION, policy_version: POLICY_VERSION, execution_mode: 'observe', mode: 'all', categories: {} }, discovery, variant: 'lite', tree, policy: POLICY_VERSION, scope: 'insert' });
  it('accepts complete passing matching coverage', () => { const evidence = createEvidence(plan, [{ id: 'test-one', status: 'passed' }]); expect(validateReuse({ plan, evidence, tree, scope: 'insert' })).toBe(true); });
  it('rejects skips, stale trees, scopes and tampered concrete plans', () => {
    const evidence = createEvidence(plan, [{ id: 'test-one', status: 'passed' }]);
    expect(validateReuse({ plan, evidence: createEvidence(plan, [{ id: 'test-one', status: 'skipped' }]), tree, scope: 'insert' })).toBe(false);
    expect(validateReuse({ plan, evidence, tree: 'other', scope: 'insert' })).toBe(false);
    expect(validateReuse({ plan, evidence, tree, scope: 'render' })).toBe(false);
    expect(validateReuse({ plan: { ...plan, tests: [] }, evidence, tree, scope: 'insert' })).toBe(false);
  });
});
