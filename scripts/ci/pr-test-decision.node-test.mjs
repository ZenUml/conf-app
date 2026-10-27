import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import yaml from 'js-yaml';
import { dispatchBody } from './wait-for-e2e.mjs';

const workflow = async name => yaml.load(await readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const [pr, child, runner, metadata, exporting, main, nightly] = await Promise.all([
  'pr-validation', 'pr-e2e-validation', 'e2e-test', 'pr-test-decision', 'export-modal-nightly', 'main-staging-validation', 'staging-transaction',
].map(workflow));
const steps = job => job.steps ?? [];
const needs = job => Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
const runText = job => steps(job).map(step => step.run ?? '').join('\n');
const defaultRef = '${{ github.event.repository.default_branch }}';
const authorization = job => steps(job).find(step => /pr-decision\.mjs check\b/.test(step.run ?? ''));

// Evaluate the trusted workflow's actual condition under representative states,
// rather than asserting the spelling or formatting of a particular expression.
function allows(job, values = {}) {
  const defaults = {
    'needs.gate.outputs.run': 'true', 'needs.select.result': 'success',
    'needs.staging-lite.result': 'success', 'needs.e2e-auth-lite.result': 'success',
    'github.event_name': 'pull_request', 'github.event.action': 'opened', 'github.event.label.name': '',
    'github.event.pull_request.draft': true, 'inputs.pr-number': '',
  };
  const expression = String(job.if ?? 'true').replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '')
    .replace(/cancelled\(\)/g, 'false')
    .replace(/\b(?:needs|github|inputs)(?:\.[\w-]+)+/g, key => JSON.stringify({...defaults,...values}[key]));
  return Boolean(Function(`return (${expression})`)());
}

test('all PR browser E2E lanes require successful current selection, including Draft PRs', () => {
  for (const id of ['preview-e2e', 'export-e2e', 'e2e-auth-lite', 'pr-e2e-validation']) {
    const job = pr.jobs[id];
    assert.ok(needs(job).includes('select'), `${id} must depend on authorization`);
    assert.equal(allows(job), true, `${id} can run while Draft with a valid decision`);
    for (const result of ['failure','cancelled','skipped']) assert.equal(allows(job, {'needs.select.result':result}), false, `${id} blocks ${result} authorization`);
  }
});

test('build, unit tests and deployment remain independent of test triage', () => {
  for (const id of ['build','staging-lite']) {
    assert.ok(!needs(pr.jobs[id]).includes('select'));
    assert.equal(allows(pr.jobs[id], {'needs.select.result':'failure'}), true);
    assert.equal(allows(pr.jobs[id], {'needs.gate.outputs.run':'false'}), false);
  }
  assert.match(runText(pr.jobs.build), /pnpm test:unit/);
});

test('PR selection uses trusted comment authorization with no Jev request or force-full input', () => {
  assert.ok(!('force-all' in pr.on.workflow_dispatch.inputs));
  assert.ok(!Object.values(pr.jobs).some(job => /classify\.mjs|TYPESAFE_API_KEY|HUMAN_FULL/.test(JSON.stringify(job))));
  const job = pr.jobs.select;
  assert.ok(authorization(job));
  for (const step of steps(job).filter(step => step.uses?.startsWith('actions/checkout@'))) assert.equal(step.with.ref, defaultRef);
  const artifacts = steps(job).filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(artifacts.some(step => step.with.path === 'test-selection.json'));
  assert.ok(artifacts.some(step => /selection\.json/.test(step.with.path) && /changed-files\.txt/.test(step.with.path)));
});

test('test:run requests an ordinary PR run and cannot grant authorization', () => {
  assert.ok(pr.on.pull_request.types.includes('labeled'));
  assert.ok(!pr.on.pull_request['paths-ignore'], 'docs-only and skill-only PR requests still need smoke');
  assert.equal(allows(pr.jobs.gate, {'github.event.action':'labeled','github.event.label.name':'test:run'}),true);
  for (const name of ['test:selected','test:all-approved','test:all','test:jev-all']) assert.equal(allows(pr.jobs.gate, {'github.event.action':'labeled','github.event.label.name':name}),false);
  assert.ok(authorization(pr.jobs.select));
  assert.equal(pr.jobs.select.needs,'gate');
});

test('PR child dispatch binds candidate, PR, decision and requested scope on the trusted default branch', () => {
  const dispatcher = steps(pr.jobs['pr-e2e-validation']).find(step=>step.env?.CHILD_KIND==='pr');
  assert.equal(dispatcher.env.DISPATCH_REF,defaultRef);
  assert.equal(dispatcher.env.PR_NUMBER,'${{ needs.gate.outputs.pr-number }}');
  assert.equal(dispatcher.env.DECISION_ID,'${{ needs.select.outputs.decision-id }}');
  assert.equal(dispatcher.env.SOURCE_SHA,'${{ needs.gate.outputs.candidate }}');
  const body = dispatchBody({CHILD_KIND:'pr',DISPATCH_REF:'main',SOURCE_SHA:'a'.repeat(40),GITHUB_RUN_ID:'10',GITHUB_RUN_ATTEMPT:'2',PR_NUMBER:'42',DECISION_ID:'100',MODE:'selected',GREP:'@smoke'});
  assert.equal(body.ref,'main');
  assert.equal(body.inputs['pr-number'],'42');
  assert.equal(body.inputs['decision-id'],'100');
  assert.equal(body.inputs.mode,'selected');
  assert.equal(body.inputs.grep,'@smoke');
  assert.ok(authorization(child.jobs.parent));
  assert.match(runText(child.jobs.parent),/--verify-parent/);
});

test('each PR staging suite requires guarded artifacts and rechecks before planning and shard execution', () => {
  for (const id of ['lite','render']) {
    const call = child.jobs[id];
    assert.equal(call.with['require-pr-decision'],true);
    assert.equal(call.with.planned,true);
    assert.equal(call.with['pr-number'],'${{ inputs.pr-number }}');
    assert.equal(call.with['decision-id'],'${{ inputs.decision-id }}');
    assert.ok(needs(call).includes('parent'));
  }
  for (const id of ['plan','test']) {
    const guard=authorization(runner.jobs[id]);
    assert.ok(guard,`${id} needs a fresh authorization check`);
    assert.equal(guard.if,'inputs.require-pr-decision');
    assert.equal(guard.env.DECISION_ID,'${{ inputs.decision-id }}');
    const controller=steps(runner.jobs[id]).find(step=>step.with?.path==='.pr-test-controller');
    assert.equal(controller.with.ref,defaultRef);
    assert.ok(steps(runner.jobs[id]).indexOf(guard)<steps(runner.jobs[id]).findIndex(step=>/prepare-plan\.mjs|run\.mjs --plan/.test(step.run??'')));
  }
  const planning = steps(runner.jobs.plan).find(step=>/prepare-plan\.mjs/.test(step.run??''));
  assert.equal(planning.env.REQUIRE_PR_DECISION,'${{ inputs.require-pr-decision }}');
});

test('standalone preview and export browser suites are guarded, while default-branch export nightly remains independent', () => {
  assert.ok(authorization(pr.jobs['preview-e2e']));
  assert.equal(pr.jobs['export-e2e'].with['decision-id'],'${{ needs.select.outputs.decision-id }}');
  assert.ok(needs(exporting.jobs['export-modal']).includes('authorize'));
  const guard=authorization(exporting.jobs.authorize);
  assert.ok(guard);
  assert.match(guard.run,/\[ "\$BRANCH" = "\$DEFAULT_BRANCH" \]/);
  assert.ok(exporting.on.schedule.length);
});

test('privileged early metadata handles every PR and runs only trusted controller code', () => {
  assert.ok(metadata.on.pull_request_target.types.includes('opened'));
  assert.ok(metadata.on.pull_request_target.types.includes('synchronize'));
  assert.ok(!metadata.on.pull_request_target['paths-ignore']);
  assert.ok(metadata.on.issue_comment.types.includes('deleted'));
  for (const job of Object.values(metadata.jobs)) {
    for (const step of steps(job).filter(step=>step.uses?.startsWith('actions/checkout@'))) assert.equal(step.with.ref,defaultRef);
    for (const step of steps(job).filter(step=>step.run)) {
      assert.match(step.run,/pr-decision\.mjs sync\b/);
      assert.doesNotMatch(step.run,/pnpm|npm|git checkout|github\.event\.pull_request\.head/);
    }
  }
});

test('legacy automatic Jev publisher and branch-ref full override no longer exist', async () => {
  for (const name of ['test-selection-labels','test-all-override']) await assert.rejects(access(new URL(`../../.github/workflows/${name}.yml`,import.meta.url)),{code:'ENOENT'});
});

test('main and nightly keep their independent coverage policies', () => {
  assert.equal(runner.on.workflow_call.inputs['require-pr-decision'].default,false);
  const classify=Object.values(main.jobs).flatMap(steps).find(step=>/classify\.mjs/.test(step.run??''));
  assert.ok(classify);
  assert.match(classify.run,/--scope main/);
  assert.equal(classify.env.SELECTION_SCOPE,'main');
  for (const caller of Object.values(nightly.jobs).filter(job=>job.uses?.endsWith('/e2e-test.yml'))) {
    assert.notEqual(caller.with['require-pr-decision'],true);
    assert.ok(!caller.with['pr-number']);
  }
});


test('ignored label updates cannot replace the authoritative Pipeline outcome check', () => {
  const expression = pr.jobs['pr-pipeline-outcome'].name.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '');
  const evaluate = (action, label) => Function(`return (${expression.replace(/github\.event_name/g, JSON.stringify('pull_request')).replace(/github\.event\.action/g, JSON.stringify(action)).replace(/github\.event\.label\.name/g, JSON.stringify(label))})`)();
  assert.equal(evaluate('opened', ''), 'Pipeline outcome');
  assert.equal(evaluate('synchronize', ''), 'Pipeline outcome');
  assert.equal(evaluate('labeled', 'test:run'), 'Pipeline outcome');
  for (const label of ['test:triage', 'test:selected', 'test:all-approved', 'bug']) assert.notEqual(evaluate('labeled', label), 'Pipeline outcome');
});

test('API integration is selected by the trusted controller and rechecks before candidate execution', () => {
  const parent = child.jobs.parent, lane = child.jobs['oauth-token-integration'];
  assert.match(runText(parent), /api-plan\.mjs plan test-selection\.json/);
  assert.equal(parent.outputs['oauth-token'], '${{ steps.api-plan.outputs.oauth-token }}');
  assert.ok(needs(lane).includes('parent'));
  assert.equal(allows(lane, {'needs.parent.outputs.oauth-token':'true'}), true);
  assert.equal(allows(lane, {'needs.parent.outputs.oauth-token':'false'}), false);
  const checkout = steps(lane).filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout[0].with.ref, defaultRef);
  assert.equal(checkout[1].with.ref, '${{ inputs.source-sha }}');
  assert.ok(steps(lane).indexOf(authorization(lane)) < steps(lane).indexOf(checkout[1]));
  assert.match(runText(lane), /api-plan\.mjs verify oauth-token candidate/);
  assert.match(runText(lane), /pnpm test:oauth-integration/);
});

test('parent gate records PR and candidate provenance for child verification', () => {
  const gate = pr.jobs.gate;
  const record = steps(gate).find(step => step.name === 'Record parent candidate provenance');
  assert.equal(record.env.PR, '${{ steps.gate.outputs.pr-number }}');
  assert.equal(record.env.CANDIDATE, '${{ steps.gate.outputs.candidate }}');
  assert.match(runText(gate), /pr-parent-provenance\.json/);
  const guard = steps(child.jobs.parent).find(step => /--verify-parent/.test(step.run ?? ''));
  assert.equal(guard.env.PR_NUMBER, '${{ inputs.pr-number }}');
  assert.equal(guard.env.SOURCE_SHA, '${{ inputs.source-sha }}');
});
