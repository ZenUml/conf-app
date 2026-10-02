import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createPlan } from './plan.mjs';
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
let legacyGrep = process.env.LEGACY_GREP || '';
if (legacyGrep) args.push(`--grep=${legacyGrep}`);
let discovery;
try { discovery = JSON.parse(execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })); }
catch (error) {
  // A legacy grep can exclude every auxiliary-scope test. Widen that scope
  // rather than failing a successful selective PR or accepting an empty plan.
  if (!legacyGrep || !['render', 'graph-publish'].includes(suite)) throw error;
  let failed; try { failed = JSON.parse(error.stdout); } catch { throw error; }
  if (!failed.errors?.length || !failed.errors.every(e => /No tests found/.test(e.message))) throw error;
  args.splice(args.indexOf(`--grep=${legacyGrep}`), 1);
  legacyGrep = '';
  discovery = JSON.parse(execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
let selection = null;
if (process.env.SELECTION_PATH) selection = JSON.parse(readFileSync(process.env.SELECTION_PATH));
// Observation proposal is never an execution permission. The legacy-filtered
// discovery remains the authority until a calibrated policy is shipped.
const plan = createPlan({ selection, discovery, variant, tree, policy: POLICY_VERSION,
  shards: Number(process.env.MAX_SHARDS || 1), scope: suite === 'regression' ? 'all' : suite === 'regression-render' ? 'render' : suite, legacyGrep });
writeFileSync('test-plan.json', JSON.stringify(plan, null, 2));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
  `shard-matrix=${JSON.stringify(plan.shards.map(s => s.index))}\nshard-count=${plan.shards.length}\n`);
