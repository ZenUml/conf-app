import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import yaml from 'js-yaml';

const root = new URL('../../', import.meta.url);
const load = path => yaml.load(readFileSync(new URL(path, root), 'utf8'));
const workflow = name => load(`.github/workflows/${name}.yml`);
const dependencies = job => Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];

test('daily fans out all four product transactions behind one shared migration gate', () => {
  const daily = workflow('daily-regression');
  assert.deepEqual(dependencies(daily.jobs.migrations), ['target']);
  assert.equal(daily.jobs.migrations.environment, 'staging-lite');
  const migrationSteps = daily.jobs.migrations.steps.filter(step => step.run?.includes('d1 migrations apply'));
  assert.equal(migrationSteps.length, 1);
  assert.match(migrationSteps[0].run, /cp wrangler-stg\.toml wrangler\.toml/);
  assert.match(migrationSteps[0].run, /d1 migrations apply DB --remote --env production/);
  for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
    assert.deepEqual(dependencies(daily.jobs[variant]), ['target', 'migrations']);
    assert.equal(daily.jobs[variant].if, undefined);
  }
  assert.deepEqual(daily.on.schedule, [{ cron: '0 3 * * *', timezone: 'Australia/Melbourne' }]);
  for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
    const transaction = daily.jobs[variant];
    assert.equal(transaction.uses, './.github/workflows/staging-transaction.yml');
    assert.equal(transaction.with.ref, '${{ needs.target.outputs.sha }}');
    assert.equal(transaction.with['skip-migrations'], true);
    assert.equal(transaction.with['backend-sha-only'], true);
    assert.equal(transaction.with['workflow-ref'], '${{ github.workflow_sha }}');
    assert.ok(dependencies(daily.jobs.summary).includes(variant));
  }
  assert.ok(dependencies(daily.jobs.summary).includes('migrations'));
  assert.equal(daily.concurrency.group, 'conf-app-staging');
  assert.equal(daily.concurrency['cancel-in-progress'], false);
  assert.equal(daily.concurrency.queue, 'max');
  assert.match(daily.jobs.target.steps.find(step => step.id === 'target').run, /git merge-base --is-ancestor "\$REQUESTED_SHA" HEAD/);
});

test('daily transaction keeps each deploy and gates both suites on backend and frontend identity', () => {
  const transaction = workflow('staging-transaction');
  const inputs = transaction.on.workflow_call.inputs;
  assert.equal(inputs['skip-migrations'].default, false);
  assert.equal(inputs['backend-sha-only'].default, false);
  assert.equal(inputs['workflow-ref'].default, '');
  assert.equal(transaction.jobs.deploy.uses, './.github/workflows/staging-deploy.yml');
  assert.equal(transaction.jobs.deploy.with['skip-migrations'], '${{ inputs.skip-migrations }}');
  assert.equal(transaction.jobs.deploy.with['workflow-ref'], '${{ inputs.workflow-ref }}');
  assert.deepEqual(dependencies(transaction.jobs.version), ['profile', 'deploy', 'auth']);
  for (const suite of ['tests', 'render']) assert.deepEqual(dependencies(transaction.jobs[suite]), ['profile', 'version']);
  const steps = transaction.jobs.version.steps;
  assert.equal(steps.find(step => step.name === 'Checkout daily verification tooling').with.ref, '${{ inputs.workflow-ref }}');
  const backend = steps.find(step => step.name === 'Verify backend source identity');
  assert.ok(steps.indexOf(steps.find(step => step.name === 'Checkout daily verification tooling')) < steps.indexOf(backend));
  assert.equal(backend.env.BACKEND_SHA_ONLY, '${{ inputs.backend-sha-only }}');
  assert.match(backend.run, /if \[ "\$BACKEND_SHA_ONLY" = true \]; then ARGS\+=\(--sha-only\); fi/);
  assert.match(backend.run, /\.ci-workflow\/\$VERIFY_SCRIPT/);
  assert.equal(steps.find(step => step.name === 'Observe loaded Forge frontend version').env.EXPECTED_APP_VERSION, 'ci-${{ inputs.ref }}-${{ inputs.variant }}');
  const auth = workflow('e2e-auth').jobs.auth;
  assert.equal(auth.concurrency.group, 'e2e-auth');
  assert.equal(auth.concurrency['cancel-in-progress'], false);
  assert.equal(auth.concurrency.queue, 'max');
});

test('migration skip is opt-in and independent callers retain their migration defaults', () => {
  const deploy = workflow('staging-deploy');
  assert.equal(deploy.on.workflow_call.inputs['skip-migrations'].default, false);
  assert.equal(deploy.on.workflow_call.inputs['workflow-ref'].default, '');
  const publish = deploy.jobs.deploy.steps.find(step => step.uses === './.github/actions/wrangler-publish');
  assert.equal(publish.with['skip-migrations'], "${{ inputs.skip-migrations && 'true' || 'false' }}");
  const tooling = deploy.jobs.deploy.steps.find(step => step.name === 'Use pinned workflow deployment tooling');
  const checkout = deploy.jobs.deploy.steps.find(step => step.name === 'Checkout pinned workflow tooling');
  assert.equal(checkout.with.ref, '${{ needs.resolve.outputs.tooling-ref }}');
  assert.equal(checkout.with.path, '.ci-workflow');
  assert.ok(deploy.jobs.deploy.steps.indexOf(checkout) < deploy.jobs.deploy.steps.indexOf(tooling));
  assert.ok(deploy.jobs.deploy.steps.indexOf(tooling) < deploy.jobs.deploy.steps.indexOf(publish));
  assert.equal(tooling.if, "needs.resolve.outputs.tooling-ref != ''");
  assert.match(tooling.run, /^cp \.ci-workflow\/\.github\/actions\/wrangler-publish\/action\.yml \.github\/actions\/wrangler-publish\/action\.yml\n/);
  const action = load('.github/actions/wrangler-publish/action.yml');
  assert.equal(action.inputs['skip-migrations'].default, 'false');
  assert.equal(action.runs.steps.find(step => step.name === 'Run D1 Migrations').if, "inputs.skip-migrations != 'true' && inputs.preparation-mode != 'candidate'");
  for (const file of readdirSync(new URL('.github/workflows/', root)).filter(file => file.endsWith('.yml'))) {
    if (['daily-regression.yml', 'staging-transaction.yml', 'staging-deploy.yml'].includes(file)) continue;
    // Main staging owns its own shared migration gate, so its deploys can
    // opt out independently of the daily regression owner.
    const ownsMigrationGate = ['main-staging-validation.yml', 'lite-deploy-benchmark.yml'].includes(file);
    const existing = load(`.github/workflows/${file}`);
    for (const job of Object.values(existing.jobs)) {
      if (!ownsMigrationGate) assert.equal(job.with?.['skip-migrations'], undefined, `${file} job migration default`);
      assert.equal(job.with?.['backend-sha-only'], undefined, `${file} job verification default`);
      for (const step of job.steps || []) {
        if (!ownsMigrationGate) assert.equal(step.with?.['skip-migrations'], undefined, `${file} action migration default`);
      }
    }
  }
});
