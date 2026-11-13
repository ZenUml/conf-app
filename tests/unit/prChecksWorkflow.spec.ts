import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const text = (name: string) => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
const structure = (name: string) => load(text(name)) as any;

describe('PR checks that do not touch staging', () => {
  const checks = structure('pr-checks');

  it('holds no staging lock and cancels older runs of the same PR', () => {
    const expression = checks.concurrency.group.match(/\$\{\{([^}]*github\.event\.action[^}]*)\}\}/)[1];
    const group = (action: string, label: string) => Function(`return (${expression.replace(/github\.event\.action/g, JSON.stringify(action)).replace(/github\.event\.label\.name/g, JSON.stringify(label))})`)();
    expect(checks.concurrency['cancel-in-progress']).toBe(true);
    expect(group('opened', '')).toBe('commit');
    expect(group('labeled', 'test:run')).toBe('request');
    expect(group('labeled', 'bug')).toBe('ignored');
    expect(text('pr-checks')).not.toContain('conf-app-staging');
  });

  it('runs unit tests, the AsyncAPI build and the Viewer preview', () => {
    expect(Object.keys(checks.jobs).sort()).toEqual(['asyncapi-build', 'authorize-preview', 'build', 'preview-e2e', 'unit']);
    const guard = checks.jobs['authorize-preview'];
    expect(guard.steps.find((step: any) => step.uses?.startsWith('actions/checkout@')).with.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(guard.steps.find((step: any) => step.run?.includes('pr-decision.mjs check'))).toBeDefined();
    expect(checks.jobs['preview-e2e'].needs).toBe('authorize-preview');
    expect(checks.jobs['preview-e2e'].if).toContain("needs.authorize-preview.result == 'success'");
    expect(checks.jobs.unit.if).toContain("github.event.action != 'labeled'");
    expect(checks.jobs['asyncapi-build'].if).toContain("github.event.action != 'labeled'");
    expect(guard.if).toContain("github.event.label.name == 'test:run'");
    const runs = checks.jobs['asyncapi-build'].steps.map((step: any) => step.run);
    expect(runs).toContain('pnpm build:asyncapi');
    expect(runs).toContain('node --test scripts/ci/*.node-test.mjs scripts/test-selection/tests/*.node-test.mjs');
  });

  it('splits the unit tests into four shards that all run even if one fails', () => {
    const { unit } = checks.jobs;
    expect(unit.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(unit.strategy['fail-fast']).toBe(false);
    expect(unit.steps.map((step: any) => step.run)).toContain('pnpm test:unit --shard=${{ matrix.shard }}/4');
    expect(JSON.stringify(unit.steps)).not.toContain('asyncapi-studio');
  });

  it('keeps one Build and Unit Test result that fails unless every part succeeded', () => {
    const { build } = checks.jobs;
    expect(build.name).toContain('Build and Unit Test');
    expect(build.needs).toEqual(['unit', 'asyncapi-build']);
    expect(build.if).toContain('always()');
    expect(build.if).toContain("github.event.action != 'labeled'");
    const env = build.steps[0].env;
    expect(env.UNIT).toBe('${{ needs.unit.result }}');
    expect(env.ASYNCAPI).toBe('${{ needs.asyncapi-build.result }}');
    const script = build.steps[0].run;
    for (const results of [['failure', 'success'], ['success', 'failure'], ['cancelled', 'success'], ['skipped', 'success']]) {
      const { status } = spawnSync('bash', ['-c', script], { env: { UNIT: results[0], ASYNCAPI: results[1] } });
      expect(status).not.toBe(0);
    }
    expect(spawnSync('bash', ['-c', script], { env: { UNIT: 'success', ASYNCAPI: 'success' } }).status).toBe(0);
  });

  it('never deploys and receives no staging credentials', () => {
    const yaml = text('pr-checks');
    for (const forbidden of ['staging-deploy', 'forge deploy', 'wrangler pages', 'CLOUDFLARE_', 'secrets.', 'environment:']) {
      expect(yaml).not.toContain(forbidden);
    }
  });

  it('covers the same paths, and does not repeat the commit when a draft is marked ready', () => {
    const validation = structure('pr-validation');
    expect(checks.on.pull_request['paths-ignore']).toEqual(validation.on.pull_request['paths-ignore']);
    expect(checks.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened', 'labeled']);
    expect(checks.jobs['authorize-preview'].if).toContain("github.event.label.name == 'test:run'");
  });
});

describe('PR validation that owns staging', () => {
  const validation = structure('pr-validation');
  const expectedSha = '${{ steps.gate.outputs.head-sha }}';
  const prNumber = '${{ github.event.pull_request.number || inputs.pr-number }}';

  it('keeps one queued, uncancelled lock across the deploy and the E2E run', () => {
    expect(validation.concurrency).toEqual({ group: 'conf-app-staging', 'cancel-in-progress': false, queue: 'max' });
    expect(validation.jobs['staging-lite'].uses).toBe('./.github/workflows/staging-deploy.yml');
    expect(validation.jobs['pr-e2e-validation'].needs).toContain('staging-lite');
    expect(validation.jobs).not.toHaveProperty('build');
    expect(validation.jobs).not.toHaveProperty('preview-e2e');
    expect(validation.jobs['pr-pipeline-outcome'].needs).not.toContain('build');
    expect(validation.jobs['pr-pipeline-outcome'].needs).not.toContain('preview-e2e');
  });

  it('skips every staging job when the lock arrives after a newer push', () => {
    const { gate } = validation.jobs;
    const current = gate.steps.find((step: any) => step.id === 'current');
    expect(current.run).toBe('node scripts/ci/pr-head-current.mjs');
    expect(current.env).toMatchObject({ PR_NUMBER: prNumber, EXPECTED_SHA: expectedSha });
    expect(gate.permissions['pull-requests']).toBe('read');
    expect(gate.outputs.run).toBe("${{ steps.gate.outputs.run == 'true' && steps.current.outputs.current != 'false' }}");
    expect(validation.jobs['staging-lite'].if).toContain("needs.gate.outputs.run == 'true'");
  });

  it('skips the E2E run when a newer push lands during the deploy, and still closes the child', () => {
    const job = validation.jobs['pr-e2e-validation'];
    const names = job.steps.map((step: any) => step.id ?? step.name);
    const current = job.steps.find((step: any) => step.id === 'current');
    expect(current.run).toBe('node scripts/ci/pr-head-current.mjs');
    expect(current.env).toMatchObject({ PR_NUMBER: prNumber, EXPECTED_SHA: '${{ needs.gate.outputs.head-sha }}' });
    expect(job.permissions['pull-requests']).toBe('read');
    expect(names.indexOf('current')).toBeLessThan(names.indexOf('Dispatch and wait for E2E'));
    const dispatch = job.steps.find((step: any) => step.name === 'Dispatch and wait for E2E');
    expect(dispatch.if).toBe("${{ !cancelled() && steps.current.outputs.current != 'false' }}");
    expect(job.steps.find((step: any) => step.name === 'Close any active child run').if).toBe('${{ always() }}');
  });
});
