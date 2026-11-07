import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const text = (name: string) => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
const structure = (name: string) => load(text(name)) as any;

describe('PR checks that do not touch staging', () => {
  const checks = structure('pr-checks');

  it('holds no staging lock and cancels older runs of the same PR', () => {
    expect(checks.concurrency).toEqual({
      group: 'pr-checks-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    });
    expect(text('pr-checks')).not.toContain('conf-app-staging');
  });

  it('runs unit tests, the AsyncAPI build and the Viewer preview', () => {
    expect(Object.keys(checks.jobs).sort()).toEqual(['build', 'preview-e2e']);
    expect(checks.jobs.build.name).toBe('Build and Unit Test');
    expect(checks.jobs['preview-e2e'].name).toBe('E2E: Viewer preview');
    const runs = checks.jobs.build.steps.map((step: any) => step.run);
    expect(runs).toContain('pnpm test:unit');
    expect(runs).toContain('pnpm build:asyncapi');
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
    expect(checks.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
  });
});

describe('PR validation that owns staging', () => {
  const validation = structure('pr-validation');
  const expectedSha = '${{ github.event.pull_request.head.sha || github.sha }}';
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
    expect(current.env).toMatchObject({ PR_NUMBER: prNumber, EXPECTED_SHA: expectedSha });
    expect(job.permissions['pull-requests']).toBe('read');
    expect(names.indexOf('current')).toBeLessThan(names.indexOf('Dispatch and wait for E2E'));
    const dispatch = job.steps.find((step: any) => step.name === 'Dispatch and wait for E2E');
    expect(dispatch.if).toBe("${{ !cancelled() && steps.current.outputs.current != 'false' }}");
    expect(job.steps.find((step: any) => step.name === 'Close any active child run').if).toBe('${{ always() }}');
  });
});
