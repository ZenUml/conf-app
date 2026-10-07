import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import { validateReuse } from '../../scripts/test-selection/reuse.mjs';
import { createPlan } from '../../scripts/test-selection/plan.mjs';
import { createEvidence } from '../../scripts/test-selection/evidence.mjs';
import { CATEGORY_VERSION, CATEGORIES } from '../e2e-tests/config/categories.mjs';
import { POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
const workflow = (name: string) => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
const structure = (name: string) => load(workflow(name)) as any;
const children = ['pr-e2e-validation', 'staging-lite-e2e', 'staging-full-e2e', 'staging-diagramly-e2e', 'staging-asyncapi-e2e'];
describe('staging workflow safety contracts', () => {
  it('holds queued staging ownership through parent deploy/test runs without nested same-group locks', () => {
    for (const name of ['build-test-deploy', 'pr-validation', 'daily-regression']) { const yaml = workflow(name); expect(yaml).toMatch(/concurrency:\n  group: conf-app-staging\n  cancel-in-progress: false\n  queue: max/); }
    expect(workflow('staging-deploy')).toContain("github.workflow == 'Staging Deploy' && 'conf-app-staging'");
    expect(workflow('staging-transaction')).not.toContain('concurrency:');
  });
  it('runs dependency-free aggregation without requiring a pnpm executable', () => { const evidenceJob = workflow('e2e-test').split('  evidence:')[1].split('  merge-reports:')[0]; expect(evidenceJob).toContain('package-manager-cache: false'); for (const name of ['daily-regression', 'test-selection-labels']) expect(workflow(name)).toContain('package-manager-cache: false'); });
  it('measures setup time on each test shard runner', () => {
    const testJob = workflow('e2e-test').split('  test:')[1].split('  evidence:')[0];
    expect(testJob).toContain('name: Start shard timing');
    expect(testJob).toContain('RUNNER_STARTED_AT_MS=$(date +%s%3N)');
    expect(testJob).toContain('RUNNER_SETUP_DURATION_MS=$(( $(date +%s%3N) - RUNNER_STARTED_AT_MS ))');
  });
  it('isolates shard graphs in dispatched children while parents wait for their verdict', () => {
    const main = structure('build-test-deploy');
    const pr = structure('pr-validation');
    expect(main.on).not.toHaveProperty('pull_request');
    expect(main.on.push.branches).toEqual(['main']);
    expect(pr.on).toHaveProperty('pull_request');
    expect(pr.on.workflow_dispatch.inputs['force-all']).toMatchObject({ type: 'boolean', default: false });
    expect(pr.on.workflow_dispatch.inputs['pr-number'].type).toBe('string');
    expect((main.on.workflow_dispatch?.inputs || {})).not.toHaveProperty('pr-number');
    expect((main.on.workflow_dispatch?.inputs || {})).not.toHaveProperty('force-all');
    for (const name of ['build-test-deploy', 'pr-validation']) {
      const jobs = Object.values(structure(name).jobs) as any[];
      expect(jobs.some(job => job.uses === './.github/workflows/e2e-test.yml')).toBe(false);
    }
    for (const name of children) {
      const child = structure(name);
      expect(child.on).toHaveProperty('workflow_dispatch');
      expect(child).not.toHaveProperty('concurrency');
      const testJobs = Object.entries(child.jobs).filter(([id]) => id !== 'parent');
      expect(testJobs.length).toBeGreaterThan(0);
      for (const [, job] of testJobs as [string, any][]) {
        expect(job.uses).toBe('./.github/workflows/e2e-test.yml');
        expect([job.needs].flat()).toContain('parent');
      }
      const verifier = child.jobs.parent.steps.find((step: any) => step.run === 'node scripts/ci/wait-for-e2e.mjs --verify-parent');
      expect(verifier.env.PARENT_RUN_ID).toBe('${{ inputs.parent-run-id }}');
      expect(verifier.env.PARENT_ATTEMPT).toBe('${{ inputs.parent-attempt }}');
      expect(child.jobs.parent.if).toBeUndefined();
      expect(child.on.workflow_dispatch.inputs['source-sha'].required).toBe(true);
    }
    for (const name of ['build-test-deploy', 'pr-validation']) {
      const dispatches = (Object.values(structure(name).jobs) as any[]).flatMap(job => job.steps || [])
        .filter(step => step.run === 'node scripts/ci/wait-for-e2e.mjs');
      expect(dispatches.length).toBeGreaterThan(0);
      for (const step of dispatches) {
        expect(children).toContain(step.env.CHILD_WORKFLOW.replace(/\.yml$/, ''));
        expect(step.env.SOURCE_SHA).toBe('${{ github.sha }}');
      }
    }
    expect(main.jobs['staging-full-e2e'].needs).toContain('staging-lite-e2e');
    expect(main.jobs['staging-full-e2e-now'].needs).not.toContain('staging-lite-e2e');
  });
  it('keeps parent staging ownership through cancellation cleanup', () => {
    for (const name of ['build-test-deploy', 'pr-validation']) {
      const dispatchJobs = (Object.values(structure(name).jobs) as any[])
        .filter(job => job.steps?.some((step: any) => step.run === 'node scripts/ci/wait-for-e2e.mjs'));
      expect(dispatchJobs.length).toBeGreaterThan(0);
      for (const job of dispatchJobs) {
        expect(job.if).toContain('always()');
        const dispatch = job.steps.find((step: any) => step.run === 'node scripts/ci/wait-for-e2e.mjs');
        expect(dispatch.if).toBe('${{ !cancelled() }}');
        const cleanup = job.steps.find((step: any) => step.run === 'node scripts/ci/wait-for-e2e.mjs --cleanup');
        expect(cleanup.if).toBe('${{ always() }}');
        expect(job.steps.indexOf(cleanup)).toBeGreaterThan(job.steps.indexOf(dispatch));
        for (const key of ['CHILD_WORKFLOW', 'CHILD_TITLE', 'SOURCE_SHA']) {
          expect(cleanup.env[key]).toBe(dispatch.env[key]);
        }
      }
    }
  });
  it('pins child test code and parent artifacts independently of the dispatch branch', () => {
    for (const name of children) {
      for (const job of Object.values(structure(name).jobs).filter((job: any) => job.uses) as any[]) {
        expect(job.with.ref).toBe('${{ inputs.source-sha }}');
        expect(job.with['source-run-id']).toBe('${{ inputs.parent-run-id }}');
        expect(job.with['source-attempt']).toBe('${{ inputs.parent-attempt }}');
      }
    }
    const jobs = structure('e2e-test').jobs;
    const downloads = jobs.plan.steps.filter((step: any) => step.uses?.startsWith('actions/download-artifact@'));
    expect(downloads).toHaveLength(2);
    for (const step of downloads) {
      expect(step.with['run-id']).toBe('${{ inputs.source-run-id || github.run_id }}');
      expect(step.with['github-token']).toBe('${{ github.token }}');
    }
    expect(downloads[0].with.name).toContain('inputs.source-attempt');
    const auth = jobs.test.steps.find((step: any) => step.name === 'Download shared auth state');
    expect(auth.with['run-id']).toBe('${{ inputs.auth-artifact && inputs.source-run-id || github.run_id }}');
    for (const id of ['plan', 'test', 'evidence', 'merge-reports']) {
      const checkout = jobs[id].steps.find((step: any) => step.uses?.startsWith('actions/checkout@'));
      expect(checkout.with.ref).toBe('${{ inputs.ref || github.sha }}');
    }
  });
  it('keeps classification and privileged publication on trusted code', () => {
    expect(workflow('pr-validation')).toContain('ref: ${{ github.event.pull_request.base.sha || github.sha }}');
    expect(workflow('pr-validation')).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(workflow('pr-validation')).toContain('--mode enabled');
    expect(workflow('test-selection-labels')).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow('test-all-override')).not.toContain('actions/checkout');
    expect(workflow('test-all-override')).toContain('"force-all":"true"');
    expect(workflow('test-all-override')).toContain('actions/workflows/pr-validation.yml/dispatches');
    expect(workflow('test-all-override')).not.toContain('actions/workflows/build-test-deploy.yml/dispatches');
  });
  it('preserves manual full coverage and succeeds with legitimate skips while rejecting reuse', () => {
    const yaml = workflow('pr-validation'); expect(yaml).toContain("contains(github.event.pull_request.labels.*.name, 'test:all')"); expect(yaml).toContain('Human test:all override: full E2E coverage');
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
