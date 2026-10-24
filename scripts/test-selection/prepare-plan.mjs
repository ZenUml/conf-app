import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { scopedPlan, metricsSummary } from './scoped-plan.mjs';
import { POLICY_VERSION } from './classify.mjs';

export const SUITES = {
  insert: ['auth', 'insert', 'feedback'],
  render: ['auth', 'pages', 'render'],
  fullscreen: ['auth', 'fullscreen'],
  'graph-publish': ['auth', 'fullscreen'],
  asyncapi: ['auth', 'asyncapi'],
  all: ['auth', 'pages', 'render', 'insert', 'feedback', 'syntax-validation'],
  'regression-render': ['auth', 'pages', 'render'],
  regression: ['auth', 'insert', 'feedback', 'syntax-validation', 'fullscreen', 'agent-link', 'asyncapi'],
};

const suite = process.env.TEST_SUITE || 'all';
if (!SUITES[suite]) throw new Error('Unknown test suite');
const app = process.env.APP;
const variant = app === 'zenuml-lite@stg' ? 'lite' : app === 'zenuml-full@stg' ? 'full' : app?.split('@')[0];
const args = ['exec', 'playwright', 'test', '--list', '--reporter=json', ...SUITES[suite].map(p => `--project=${p}`)];
if (suite === 'graph-publish') args.push('tests/fullscreen/graph-edit.spec.ts');
const cache = new Map();
function discover(grep) {
  if (cache.has(grep)) return cache.get(grep);
  const command = [...args, ...(grep ? [`--grep=${grep}`] : [])];
  let discovery;
  try { discovery = JSON.parse(execFileSync('pnpm', command, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })); }
  catch (error) {
    let failed; try { failed = JSON.parse(error.stdout); } catch { throw error; }
    if (!grep || !['render', 'regression-render', 'graph-publish'].includes(suite) || !failed.errors?.length || !failed.errors.every(e => /No tests found/.test(e.message))) throw error;
    discovery = discover('');
  }
  cache.set(grep, discovery);
  return discovery;
}
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
let selection = null;
if (process.env.SELECTION_PATH) {
  try { selection = JSON.parse(readFileSync(process.env.SELECTION_PATH)); }
  catch { /* Invalid or missing raw artifacts cannot narrow discovery. */ }
}
let resolved = null;
if (process.env.RESOLVED_SELECTION_PATH) {
  try { resolved = JSON.parse(readFileSync(process.env.RESOLVED_SELECTION_PATH)); } catch { /* fail full */ }
}
let sourcePaths = [];
if (process.env.CHANGED_FILES_PATH) {
  try { sourcePaths = readFileSync(process.env.CHANGED_FILES_PATH, 'utf8').split('\n').filter(Boolean); } catch { /* Metrics may omit paths but planning stays fail-safe. */ }
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const plan = scopedPlan({ discover, selection, resolved, head, tree, policy: POLICY_VERSION, variant,
  shards: Number(process.env.MAX_SHARDS || 1), scope: suite === 'regression' ? 'all' : suite === 'regression-render' ? 'render' : suite,
  grep: process.env.SELECTION_SCOPE === 'main' ? resolved?.grep || '' : process.env.LEGACY_GREP || '', sourcePaths, selectionScope: process.env.SELECTION_SCOPE || 'pr' });
writeFileSync(process.env.PLAN_PATH || 'test-plan.json', JSON.stringify(plan, null, 2));
writeFileSync(process.env.METRICS_PATH || 'selection-metrics.json', JSON.stringify(plan.selection_metrics, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, metricsSummary(plan.selection_metrics));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
  `shard-matrix=${JSON.stringify(plan.shards.map(s => s.index))}\nshard-count=${plan.shards.length}\n`);
