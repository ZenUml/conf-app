import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
const workflow = name => yaml.load(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('manual controls belong to the five-node root, never direct child dispatch', () => {
  const root = workflow('build-test-deploy');
  assert.equal(Object.keys(root.jobs).length, 5);
  assert.deepEqual(Object.keys(root.on.workflow_dispatch.inputs), ['full-tests', 'bypass-regression-gate', 'bypass-reason']);
  assert.equal(root.on.workflow_dispatch.inputs['full-tests'].type, 'boolean');
  assert.ok(root.jobs.version.steps.some(step => step.with?.name === 'main-root-options-${{ github.run_attempt }}'));
  for (const phase of ['main-staging-validation', 'main-draft-preparation']) {
    const child = workflow(phase);
    assert.equal('bypass-regression-gate' in child.on.workflow_dispatch.inputs, false);
    assert.equal('full-tests' in child.on.workflow_dispatch.inputs, false);
    assert.match(child.jobs.parent.steps.find(step => step.id === 'owner').run, /--verify-parent/);
  }
});

test('main child plans consume the verified producer and complete variant inventories', () => {
  for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
    const child = workflow(`staging-${variant}-e2e`);
    for (const [job, suite] of [['regression', 'regression'], ['render', 'regression-render']]) {
      const inputs = child.jobs[job].with;
      assert.equal(inputs.planned, true);
      assert.equal(inputs['selection-scope'], 'main');
      assert.equal(inputs.suite, suite);
      assert.equal(inputs['source-run-id'], '${{ inputs.parent-run-id }}');
      assert.equal(inputs.ref, '${{ inputs.source-sha }}');
    }
    assert.equal(child.jobs.render.with['shard-matrix'], '[1]');
  }
  const plan = workflow('e2e-test').jobs.plan;
  const downloads = plan.steps.filter(step => step.uses === 'actions/download-artifact@v7');
  assert.equal(downloads.length, 2);
  for (const step of downloads) {
    assert.match(step.with.name, /main-test-selection/);
    assert.equal(step['continue-on-error'], true);
    assert.match(step.with['run-id'], /inputs.source-run-id/);
  }
});

test('daily gate blocks every draft while deployment ordering and full validation remain mandatory', () => {
  const drafts = workflow('main-draft-preparation');
  assert.match(drafts.jobs.parent.steps.find(step => step.id === 'regression').run, /verified-root-options.json/);
  for (const variant of ['lite', 'full', 'diagramly', 'asyncapi']) {
    const job = drafts.jobs[`draft-release-${variant}`];
    assert.match(job.if, /gate-allowed == 'true'/);
    const release = job.steps.find(step => step.id === 'createDraft');
    assert.match(release.with.body, /Bypass reason:/);
    assert.equal(release.with.commit, '${{ inputs.source-sha }}');
  }
  const stage = workflow('main-staging-validation');
  assert.equal('reuse-check' in stage.jobs, false);
  assert.ok(stage.jobs['staging-diagramly'].needs.includes('staging-lite-e2e'));
  assert.ok(stage.jobs['staging-asyncapi'].needs.includes('staging-diagramly-e2e'));
  assert.ok(stage.jobs['staging-full-e2e'].needs.includes('staging-lite-e2e'));
  assert.equal(stage.jobs.parent.steps.find(step => step.env?.SELECTION_SCOPE).env.SELECTION_SCOPE, 'main');
});
