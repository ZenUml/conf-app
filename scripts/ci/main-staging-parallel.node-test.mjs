import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
const workflow = name => yaml.load(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const stage = workflow('main-staging-validation');
const deps = job => [job.needs].flat();
const variants = ['lite', 'full', 'diagramly', 'asyncapi'];

// Run the actual job predicate with a skipped PR selector ancestor. GitHub adds
// implicit success() unless the predicate has a status function.
function eligible(id, results = {}, cancelled = false) {
  const job = stage.jobs[id];
  const needs = Object.fromEntries(deps(job).map(name => [name, {
    result: results[name] ?? 'success', outputs: { run: 'true' },
  }]));
  const expression = job.if.slice(3, -2)
    .replace(/needs\.([\w-]+)/g, 'needs["$1"]')
    .replace(/\.outputs\.([\w-]+)/g, '.outputs["$1"]');
  if (!/\b(?:cancelled|always|success|failure)\(/.test(expression)) return false;
  const github = { ref: 'refs/heads/main', event_name: 'push', event: { repository: { default_branch: 'main' } } };
  return Function('needs', 'github', 'cancelled', 'format', `return (${expression})`)(
    needs, github, () => cancelled, (_, branch) => `refs/heads/${branch}`);
}

test('one pinned shared migration gates every normal combined staging deployment', () => {
  assert.deepEqual(deps(stage.jobs.migrations), ['parent']);
  assert.equal(stage.jobs.migrations.environment, 'staging-lite');
  const steps = stage.jobs.migrations.steps;
  assert.equal(steps[0].with.ref, '${{ inputs.source-sha }}');
  // The apply command lives in one script shared by every migrations job.
  assert.equal(steps.filter(step => step.run?.includes('staging-d1-migrations.sh')).length, 1);
  assert.match(readFileSync('scripts/ci/staging-d1-migrations.sh', 'utf8'), /cp wrangler-stg.toml wrangler.toml\n.*d1 migrations apply DB --remote --env production/);
  assert.equal('backend-lite' in stage.jobs, false);
  assert.equal('backend-full' in stage.jobs, false);
  for (const variant of variants) {
    const id = `staging-${variant}`;
    const job = stage.jobs[id];
    assert.deepEqual(deps(job), ['parent', 'migrations']);
    assert.equal(job.uses, './.github/workflows/staging-deploy.yml');
    assert.equal(job.with.variant, variant);
    assert.equal(job.with['skip-migrations'], true);
    assert.equal(job.with.mode, undefined);
    assert.equal(eligible(id), true);
    for (const result of ['failure', 'skipped', 'cancelled']) assert.equal(eligible(id, { migrations: result }), false);
    assert.equal(eligible(id, {}, true), false);
  }
});

test('all four E2E lanes wait only for their own deploy and auth', () => {
  for (const variant of variants) {
    const id = `staging-${variant}-e2e`;
    assert.deepEqual(deps(stage.jobs[id]).sort(), [`staging-${variant}`, `e2e-auth-${variant}`, 'parent'].sort());
    assert.equal(eligible(id), true);
    for (const prerequisite of deps(stage.jobs[id])) {
      for (const result of ['failure', 'skipped', 'cancelled']) assert.equal(eligible(id, { [prerequisite]: result }), false);
    }
    assert.equal(eligible(id, {}, true), false);
    // The lane calls its E2E workflow in this run instead of dispatching a
    // separate run and polling it (about 30 s of dispatch and ownership checks).
    const lane = stage.jobs[id];
    assert.equal(lane.uses, `./.github/workflows/staging-${variant}-e2e.yml`);
    assert.equal(lane.steps, undefined);
    assert.deepEqual(lane.with, { 'source-sha': '${{ inputs.source-sha }}', grep: '${{ needs.parent.outputs.grep }}' });
    const child = workflow(`staging-${variant}-e2e`);
    assert.ok(child.on.workflow_call, `staging-${variant}-e2e is called`);
    assert.equal(child.on.workflow_dispatch, undefined, `staging-${variant}-e2e is no longer dispatched`);
    assert.equal(child.jobs.parent, undefined, 'the backend check runs inside each plan job');
    const planSteps = workflow('e2e-test').jobs.plan.steps;
    const check = planSteps.find(step => step.name === 'Verify pinned staging backend source');
    assert.match(check.run, /verify-backend\.mjs --sha "\$TARGET_SHA" --variant "\$VERIFY_VARIANT" --url "\$VERIFY_URL" --sha-only$/);
    assert.equal(check.env.TARGET_SHA, '${{ inputs.ref || github.sha }}');
    assert.equal(JSON.stringify(child.jobs).includes('wait-for-e2e'), false, 'no parent-run ownership check inside one run');
    for (const suite of ['regression', 'render']) {
      assert.deepEqual(deps(child.jobs[suite]).filter(Boolean), [], `${variant} ${suite} starts at once; its plan job checks the backend`);
      assert.equal(child.jobs[suite].with.planned, true);
      assert.equal(child.jobs[suite].with['verify-backend-variant'], variant);
      assert.match(child.jobs[suite].with['verify-backend-url'], /^https:\/\/conf-stg-(lite|full)\.zenuml\.com$/);
      // Artifacts (auth state, main selection) come from this same run.
      assert.equal(child.jobs[suite].with['source-run-id'], undefined);
      assert.equal(child.jobs[suite].with.grep, '${{ inputs.grep }}');
      assert.equal(child.jobs[suite].with.ref, '${{ inputs.source-sha }}');
    }
  }
  for (const result of ['failure', 'skipped', 'cancelled']) {
    assert.equal(eligible('staging-full-e2e', { 'staging-lite': result, 'staging-lite-e2e': result, 'e2e-auth-lite': result }), true);
  }
  assert.equal(Object.keys(stage.jobs).filter(id => id.startsWith('staging-full-e2e')).length, 1);
  assert.equal(stage.jobs.parent.outputs['full-now'], undefined);
  assert.equal(stage.jobs.parent.steps.some(step => step.id === 'lane'), false);
  assert.deepEqual(deps(stage.jobs.provenance).filter(id => id.startsWith('staging-full-e2e')), ['staging-full-e2e']);
  assert.equal('reuse-check' in stage.jobs, false);
});

test('no staging lane dispatches or polls a child run any more', () => {
  const text = readFileSync(new URL('../../.github/workflows/main-staging-validation.yml', import.meta.url), 'utf8');
  for (const variant of variants) assert.equal(text.includes(`CHILD_WORKFLOW: staging-${variant}-e2e.yml`), false);
  for (const id of variants.map(v => `staging-${v}-e2e`)) assert.equal(stage.jobs[id]['runs-on'], undefined);
});

test('draft eligibility requires successful migrations and combined deploy with fresh coverage', () => {
  const draft = workflow('main-draft-preparation');
  const step = draft.jobs.provenance.steps.find(step => step.id === 'eligibility');
  const code = step.run.split("<<'NODE'\n")[1].split('\nNODE')[0].replace(/^import .*;\n/gm, '');
  const good = Object.fromEntries(['migrations', ...variants.flatMap(v => [`staging-${v}`, `staging-${v}-e2e`])].map(id => [id, { result: 'success' }]));
  const resolve = results => {
    let output = '';
    Function('readFileSync', 'appendFileSync', 'process', code)(
      file => JSON.stringify({ source_sha: 'source', results: file === 'build-provenance.json' ? { build: { result: 'success' }, 'build-prod': { result: 'success' } } : results }),
      (_, value) => { output += value; }, { env: { SOURCE_SHA: 'source', GITHUB_OUTPUT: 'output' } });
    return Object.fromEntries(output.trim().split('\n').map(line => line.split('=')));
  };
  assert.deepEqual(resolve(good), Object.fromEntries(variants.map(v => [v, 'true'])));
  for (const result of ['failure', 'skipped', 'cancelled']) {
    assert.deepEqual(resolve({ ...good, migrations: { result } }), Object.fromEntries(variants.map(v => [v, 'false'])));
    for (const variant of variants) {
      for (const prerequisite of [`staging-${variant}`, `staging-${variant}-e2e`]) assert.equal(resolve({ ...good, [prerequisite]: { result } })[variant], 'false');
    }
    assert.equal(resolve({ ...good, 'staging-lite': { result }, 'staging-lite-e2e': { result } }).full, 'true');
  }
  const missingFull = { ...good };
  delete missingFull['staging-full-e2e'];
  assert.equal(resolve({ ...missingFull, 'staging-full-e2e-now': { result: 'success' } }).full, 'false');
  assert.equal(resolve({ ...good, 'staging-lite-e2e': { result: 'skipped' }, 'reuse-check': { outputs: { reuse: 'true' } } }).lite, 'false');
});

test('helper defaults preserve ordinary staging and production deployment behavior', () => {
  const deploy = workflow('staging-deploy');
  assert.equal(deploy.on.workflow_call.inputs['skip-migrations'].default, false);
  assert.equal(deploy.on.workflow_call.inputs['workflow-ref'].default, '');
  assert.equal(deploy.on.workflow_call.inputs.mode, undefined);
  assert.equal(deploy.on.workflow_dispatch.inputs.mode, undefined);
  assert.ok(!deploy.concurrency.group.includes('inputs.mode'));
  const action = yaml.load(readFileSync(new URL('../../.github/actions/wrangler-publish/action.yml', import.meta.url), 'utf8'));
  assert.equal(action.inputs['skip-migrations'].default, 'false');
  assert.equal(action.inputs['skip-cloudflare'], undefined);
  assert.equal(action.runs.steps.find(step => step.name === 'Run D1 Migrations').if, "inputs.skip-migrations != 'true' && inputs.preparation-mode != 'candidate'");
  const transaction = workflow('staging-transaction');
  assert.equal(transaction.on.workflow_call.inputs['backend-sha-only'].default, false);
  const check = transaction.jobs.version.steps.find(step => step.name === 'Verify backend source identity');
  assert.equal(check.env.BACKEND_SHA_ONLY, '${{ inputs.backend-sha-only }}');
  assert.equal(transaction.jobs.version.steps.find(step => step.name === 'Observe loaded Forge frontend version').env.EXPECTED_APP_VERSION, 'ci-${{ inputs.ref }}-${{ inputs.variant }}');
  for (const name of ['release', 'pr-validation']) {
    for (const job of Object.values(workflow(name).jobs)) {
      assert.equal(job.with?.['skip-migrations'], undefined);
      assert.equal(job.with?.['backend-sha-only'], undefined);
      for (const step of job.steps ?? []) assert.equal(step.with?.['skip-migrations'], undefined);
    }
  }
});
