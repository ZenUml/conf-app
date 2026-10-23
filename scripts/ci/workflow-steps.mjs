import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

// Workflow structure tests assert on step names and order. Since #906 some of
// those steps live in local composite actions, so expand every
// `uses: ./.github/actions/<name>` step into that action's own steps, in place.
const root = new URL('../../', import.meta.url);

function actionSteps(uses) {
  const action = yaml.load(readFileSync(new URL(`${uses.replace(/^\.\//, '')}/action.yml`, root), 'utf8'));
  return action.runs.using === 'composite' ? action.runs.steps : [];
}

export function expandedSteps(workflowName, jobName) {
  const workflow = yaml.load(readFileSync(new URL(`.github/workflows/${workflowName}.yml`, root), 'utf8'));
  return workflow.jobs[jobName].steps.flatMap(step =>
    typeof step.uses === 'string' && step.uses.startsWith('./.github/actions/')
      ? expandLocal(step.uses)
      : [step]);
}

function expandLocal(uses) {
  return actionSteps(uses).flatMap(step =>
    typeof step.uses === 'string' && step.uses.startsWith('./.github/actions/') ? expandLocal(step.uses) : [step]);
}
