import { readdirSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const { jobs } = load(readFileSync('.github/workflows/main-staging-validation.yml', 'utf8')) as any;
const downstream = ['staging-full', 'staging-diagramly', 'staging-asyncapi', 'staging-lite-e2e', 'staging-full-e2e', 'staging-diagramly-e2e', 'staging-asyncapi-e2e'];

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

describe('main AsyncAPI build coverage', () => {
  const workflowJobs = (name: string) => (load(readFileSync(`.github/workflows/${name}.yml`, 'utf8')) as any).jobs;
  const buildMain = workflowJobs('main-build-preparation');

  it('builds AsyncAPI once on main, through the gated production matrix', () => {
    expect(buildMain['build-prod'].strategy.matrix.variant).toContain('asyncapi');
    expect(buildMain['build-prod'].steps.map((step: any) => step.run)).toContain('pnpm build:${{ matrix.variant }}');
    expect(buildMain.provenance.needs).toContain('build-prod');
    const unitRuns = buildMain.build.steps.map((step: any) => step.run ?? '');
    expect(unitRuns.filter((run: string) => run.includes('pnpm build:'))).toEqual([]);
  });

  it('does not prepare AsyncAPI Studio in the main unit-test job', () => {
    expect(JSON.stringify(buildMain.build.steps)).not.toContain('asyncapi-studio');
  });

  it('keeps the AsyncAPI build check on pull requests', () => {
    // Any workflow a pull request starts counts: which one holds the job is not the point.
    const pullRequestWorkflows = readdirSync('.github/workflows')
      .map(file => load(readFileSync(`.github/workflows/${file}`, 'utf8')) as any)
      .filter(workflow => workflow.on?.pull_request);
    const steps = pullRequestWorkflows.flatMap(workflow => Object.values(workflow.jobs)).flatMap((job: any) => job.steps ?? []);
    // `build:asyncapi` is two builds; pull requests run each half in its own job.
    const runs = steps.map((step: any) => step.run);
    expect(runs).toContain('pnpm build:asyncapi:app');
    expect(runs).toContain('pnpm build:mcp-app');
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['build:asyncapi']).toBe('pnpm run build:asyncapi:app && pnpm run build:mcp-app');
  });
});

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
        const stepRuns = (step: any, cancelled: boolean) => Function('cancelled', 'always', 'success',
          `return (${step.if.slice(3, -2)})`)(() => cancelled, () => true, () => true);
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
    (file: string) => JSON.stringify(file === 'build-provenance.json' ? { source_sha: buildSource, results: buildResults } : { source_sha: source, results: { migrations: { result: 'success' }, 'staging-full': { result: 'success' }, 'staging-diagramly': { result: 'success' }, 'staging-asyncapi': { result: 'success' }, ...results } }), (_: string, value: string) => { output += value; },
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
  it('requires fresh coverage from the single Full validator', () => {
    const reuse = { result: 'success', outputs: { reuse: 'true', 'run-url': 'https://example.com/evidence' } };
    expect(variantEligibility({ 'staging-lite': { result: 'success' }, 'reuse-check': reuse, 'staging-full-e2e': { result: 'success' } }))
      .toMatchObject({ lite: 'false', full: 'true' });
    expect(variantEligibility({ 'staging-full-e2e-now': { result: 'success' } }).full).toBe('false');
    for (const result of ['failure', 'skipped', 'cancelled']) {
      expect(variantEligibility({ 'staging-full-e2e': { result }, 'staging-full-e2e-now': { result: 'success' } }).full).toBe('false');
      expect(variantEligibility({ migrations: { result }, 'staging-full-e2e': { result: 'success' } }).full).toBe('false');
      expect(variantEligibility({ 'staging-full': { result }, 'staging-full-e2e': { result: 'success' } }).full).toBe('false');
    }
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
  it('resolves eligibility beside the root check, and drafts skip the unused source checkout', () => {
    expect(draft.provenance.needs).toBeUndefined();
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
      const job = draft[`draft-release-${variant}`];
      expect(job.if).toContain("needs.parent.result == 'success'");
      expect(job.if).toContain("needs.provenance.result == 'success'");
      expect(job.steps.some((step: any) => step.uses?.startsWith('actions/checkout@'))).toBe(false);
    }
  });
  it('gates each draft separately and downloads its exact build phase artifacts', () => {
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
      const job = draft[`draft-release-${variant}`];
      expect(job.needs).toEqual(['parent', 'provenance']);
      expect(job.if).toContain(`needs.provenance.outputs.${variant} == 'true'`);
      const download = job.steps.find((step: any) => step.uses?.startsWith('actions/download-artifact@'));
      expect(download.with.name).toBe(`dist-prod-${variant}`);
      // The build phase runs in this same root run, so no other run is named.
      expect(download.with['run-id']).toBeUndefined();
      expect(job.permissions.actions).toBe('read');
      const release = job.steps.find((step: any) => step.id === 'createDraft');
      expect(release.with.commit).toBe('${{ inputs.source-sha }}');
    }
    const downloads = draft.provenance.steps.filter((step: any) => step.uses?.startsWith('actions/download-artifact@'));
    expect(downloads.map((step: any) => [step.with.name, step.with['run-id']])).toEqual([
      ['build-provenance', undefined], ['staging-provenance', undefined],
    ]);
  });
  it('reads provenance from its own root run, so no producer run is verified', () => {
    // The phases are called workflows of the root: a producer from another root,
    // attempt or workflow cannot be named, because no run ID is passed in.
    expect(draft.provenance.steps.some((step: any) => step.name === 'Verify immutable artifact producers')).toBe(false);
    const inputs = Object.keys((load(readFileSync('.github/workflows/main-draft-preparation.yml', 'utf8')) as any).on.workflow_call.inputs);
    expect(inputs).toEqual(['source-sha', 'version']);
  });
});
