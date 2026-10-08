import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const { jobs } = load(readFileSync('.github/workflows/main-staging-validation.yml', 'utf8')) as any;
const downstream = ['staging-diagramly-e2e', 'staging-asyncapi', 'staging-asyncapi-e2e'];

// Evaluate the actual workflow expressions, including GitHub's implicit success
// check. A skipped ancestor models main's intentionally skipped PR selector.
function eligible(id: string, overrides: Record<string, string> = {}, cancelled = false, ref = 'refs/heads/main') {
  const job = jobs[id];
  const needs = Object.fromEntries(job.needs.map((name: string) => [name, { result: overrides[name] ?? 'success', outputs: { run: 'true' } }]));
  const expression = job.if.slice(3, -2).replace(/needs\.([\w-]+)/g, 'needs["$1"]');
  const explicitStatus = /\b(?:cancelled|always|success|failure)\(/.test(expression);
  // The ancestor success status is false even when all direct needs succeeded.
  if (!explicitStatus) return false;
  const github = { ref, event_name: 'push', event: { repository: { default_branch: 'main' } } };
  return Function('needs', 'github', 'cancelled', 'always', 'format', `return (${expression})`)(needs, github, () => cancelled, () => true, (_: string, branch: string) => `refs/heads/${branch}`);
}

describe('main downstream staging gates', () => {
  for (const id of downstream) {
    it(`${id} runs after successful direct prerequisites despite a skipped PR-only ancestor`, () => {
      expect(eligible(id)).toBe(true);
    });
    it(`${id} rejects each unsuccessful direct prerequisite`, () => {
      for (const prerequisite of jobs[id].needs) {
        for (const result of ['failure', 'skipped', 'cancelled']) {
          expect(eligible(id, { [prerequisite]: result }), `${prerequisite}: ${result}`).toBe(false);
        }
      }
    });
    it(`${id} never dispatches work after cancellation and rejects feature branches`, () => {
      const dispatch = jobs[id].steps?.find((step: any) => step.run === 'node scripts/ci/wait-for-e2e.mjs');
      if (dispatch) {
        // Cancellation must stop the active wrapper; always() at job level
        // would keep its wait process alive. Cleanup is a step-level exception.
        expect(eligible(id, {}, true)).toBe(false);
        const stepRuns = (step: any, cancelled: boolean) => Function('cancelled', 'always',
          `return (${step.if.slice(3, -2)})`)(() => cancelled, () => true);
        expect(stepRuns(dispatch, false)).toBe(true);
        expect(stepRuns(dispatch, true)).toBe(false);
        const cleanup = jobs[id].steps.find((step: any) => step.run === 'node scripts/ci/wait-for-e2e.mjs --cleanup');
        expect(cleanup).toBeDefined();
        expect(stepRuns(cleanup, true)).toBe(true);
        expect(jobs[id].steps.indexOf(cleanup)).toBeGreaterThan(jobs[id].steps.indexOf(dispatch));
      } else {
        expect(eligible(id, {}, true)).toBe(false);
      }
      expect(eligible(id, {}, false, 'refs/heads/feature')).toBe(false);
    });
  }
});

const draft = (load(readFileSync('.github/workflows/main-draft-preparation.yml', 'utf8')) as any).jobs;
const nodeScript = (step: any) => step.run.split("<<'NODE'\n")[1].split('\nNODE')[0].replace(/^import .*;\n/gm, '');
const provenanceStep = draft.provenance.steps.find((step: any) => step.id === 'eligibility');
function variantEligibility(results: Record<string, any>, source = 'source', buildResults: Record<string, any> = { build: { result: 'success' }, 'build-prod': { result: 'success' } }, buildSource = 'source') {
  let output = '';
  Function('readFileSync', 'appendFileSync', 'process', nodeScript(provenanceStep))(
    (file: string) => JSON.stringify(file === 'build-provenance.json' ? { source_sha: buildSource, results: buildResults } : { source_sha: source, results }), (_: string, value: string) => { output += value; },
    { env: { SOURCE_SHA: 'source', GITHUB_OUTPUT: 'output' } });
  return Object.fromEntries(output.trim().split('\n').map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
}

describe('draft phase provenance and independent variant gates', () => {
  it('retains successful variants when another staging variant fails', () => {
    expect(variantEligibility({
      'staging-lite': { result: 'success' }, 'staging-lite-e2e': { result: 'failure' },
      'staging-full-e2e': { result: 'success' }, 'staging-diagramly-e2e': { result: 'success' },
      'staging-asyncapi-e2e': { result: 'failure' },
    })).toMatchObject({ lite: 'false', full: 'true', diagramly: 'true', asyncapi: 'false' });
  });
  it('requires fresh Lite coverage and accepts either Full lane', () => {
    const reuse = { result: 'success', outputs: { reuse: 'true', 'run-url': 'https://example.com/evidence' } };
    expect(variantEligibility({ 'staging-lite': { result: 'success' }, 'reuse-check': reuse, 'staging-full-e2e-now': { result: 'success' } }))
      .toMatchObject({ lite: 'false', full: 'true' });
    expect(variantEligibility({ 'staging-lite': { result: 'success' }, 'staging-lite-e2e': { result: 'success' } }).lite).toBe('true');
    for (const result of ['failure', 'skipped', 'cancelled']) {
      expect(variantEligibility({ 'staging-lite': { result }, 'reuse-check': reuse }).lite).toBe('false');
    }
    expect(variantEligibility({})).toMatchObject({ lite: 'false', full: 'false', diagramly: 'false', asyncapi: 'false' });
    expect(() => variantEligibility({}, 'different-source')).toThrow('Staging source differs from draft source');
  });
  it('preserves original build gates when preview or cron fails independently', () => {
    const staged = { 'staging-lite': { result: 'success' }, 'staging-lite-e2e': { result: 'success' },
      'staging-full-e2e': { result: 'success' }, 'staging-diagramly-e2e': { result: 'success' }, 'staging-asyncapi-e2e': { result: 'success' } };
    const ready = { build: { result: 'success' }, 'build-prod': { result: 'success' },
      'preview-e2e': { result: 'failure' }, 'deploy-cron-worker': { result: 'failure' } };
    expect(variantEligibility(staged, 'source', ready)).toMatchObject({ lite: 'true', full: 'true', diagramly: 'true', asyncapi: 'true' });
    for (const prerequisite of ['build', 'build-prod']) {
      for (const result of ['failure', 'skipped', 'cancelled']) {
        expect(variantEligibility(staged, 'source', { ...ready, [prerequisite]: { result } }))
          .toMatchObject({ lite: 'false', full: 'false', diagramly: 'false', asyncapi: 'false' });
      }
    }
    expect(() => variantEligibility(staged, 'source', ready, 'other-source')).toThrow('Build source differs from draft source');
    const build = (load(readFileSync('.github/workflows/main-build-preparation.yml', 'utf8')) as any).jobs;
    expect(build.provenance.needs).toEqual(['parent', 'build', 'build-prod', 'preview-e2e', 'deploy-cron-worker']);
    expect(build.provenance.if).toContain('always()');
    expect(build.provenance.steps[0].env.RESULTS).toBe('${{ toJSON(needs) }}');
  });
  it('gates each draft separately and downloads its exact build phase artifacts', () => {
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
      const job = draft[`draft-release-${variant}`];
      expect(job.needs).toEqual(['parent', 'provenance']);
      expect(job.if).toContain(`needs.provenance.outputs.${variant} == 'true'`);
      const download = job.steps.find((step: any) => step.uses?.startsWith('actions/download-artifact@'));
      expect(download.with.name).toBe(`dist-prod-${variant}`);
      expect(download.with['run-id']).toBe('${{ inputs.artifact-run-id }}');
      expect(download.with['github-token']).toBe('${{ github.token }}');
      expect(job.permissions.actions).toBe('read');
      const release = job.steps.find((step: any) => step.id === 'createDraft');
      expect(release.with.commit).toBe('${{ inputs.source-sha }}');
    }
    const downloads = draft.provenance.steps.filter((step: any) => step.uses?.startsWith('actions/download-artifact@'));
    expect(downloads.map((step: any) => [step.with.name, step.with['run-id']])).toEqual([
      ['build-provenance', '${{ inputs.artifact-run-id }}'], ['staging-provenance', '${{ inputs.staging-run-id }}'],
    ]);
  });
  it('rejects artifact producers from another root, source, attempt or phase', () => {
    const verifyStep = draft.provenance.steps.find((step: any) => step.name === 'Verify immutable artifact producers');
    const run = (title: string, path: string, conclusion = 'success') => ({
      path: `.github/workflows/${path}.yml`, display_title: `${title} · parent root · attempt 2 · source source`,
      status: 'completed', run_attempt: 1, conclusion,
    });
    const build = run('Build preparation', 'main-build-preparation');
    const staging = run('Staging validation', 'main-staging-validation', 'failure');
    const verify = (producer = build, stageProducer = staging) => Function('execFileSync', 'process', nodeScript(verifyStep))(
      (_: string, args: string[]) => JSON.stringify(args[1].endsWith('/build') ? producer : stageProducer),
      { env: { BUILD_RUN_ID: 'build', STAGING_RUN_ID: 'stage', PARENT_RUN_ID: 'root', PARENT_ATTEMPT: '2', SOURCE_SHA: 'source', GITHUB_REPOSITORY: 'example/repo' } });
    expect(() => verify()).not.toThrow();
    expect(() => verify({ ...build, conclusion: 'failure' })).not.toThrow();
    for (const patch of [{ path: '.github/workflows/pr-validation.yml' }, { display_title: build.display_title.replace('source source', 'source other') },
      { display_title: build.display_title.replace('parent root', 'parent other') }, { display_title: build.display_title.replace('attempt 2', 'attempt 1') },
      { status: 'in_progress' }, { run_attempt: 2 }, { conclusion: 'cancelled' }]) {
      expect(() => verify({ ...build, ...patch })).toThrow('Artifact producer does not match');
    }
    expect(() => verify(build, { ...staging, conclusion: 'cancelled' })).toThrow('Artifact producer does not match');
    const downloadIndex = draft.provenance.steps.findIndex((step: any) => step.uses?.startsWith('actions/download-artifact@'));
    expect(draft.provenance.steps.indexOf(verifyStep)).toBeLessThan(downloadIndex);
  });
});
