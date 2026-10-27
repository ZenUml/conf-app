// Read literal test metadata without importing/executing candidate test code.
// On the privileged controller these are trusted default-branch files. The
// candidate planner must agree with this inventory before narrowing a plan.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDefaultPrSpec } from './test-discovery-policy.mjs';
import { CATEGORIES } from './categories.mjs';
import { validScenarios, scenarioKey } from './product-impact.mjs';
import { API_LANES } from './api-lanes.mjs';
export { API_LANES } from './api-lanes.mjs';

const root = import.meta.url.startsWith('file:')
  ? resolve(dirname(fileURLToPath(import.meta.url)), '../tests')
  : resolve(process.cwd(), 'tests/e2e-tests/tests');
const files = dir => readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
  const path = resolve(dir, entry.name);
  return entry.isDirectory() ? files(path) : entry.name.endsWith('.spec.ts') ? [path] : [];
});
// Tag taxonomy checks require literal lists on every top-level test/describe.
const HEAD = /^(test(?:\.describe(?:\.serial|\.parallel)?)?)\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)\s*,\s*(\{[^}]*\})?/gm;
export const SCENARIO_TESTS = files(root).sort().flatMap(file => [...readFileSync(file,'utf8').matchAll(HEAD)].map(match => {
  const tags = [...(match[2]?.match(/tag:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/)?.[1] ?? '').matchAll(/@[\w:-]+/g)].map(m=>m[0]);
  const scenarios = tags.filter(tag=>tag.startsWith('@scenario:')).map(tag=>{
    const [,feature,surface]=tag.slice(1).split(':'); return {feature,interface:surface};
  });
  if (!validScenarios(scenarios)) throw new Error(`Invalid E2E scenario metadata: ${relative(root,file)}`);
  return {default_pr_collection:isDefaultPrSpec(relative(root,file).replaceAll('\\','/')), title:match[0].match(/\(\s*(['"`])([\s\S]*?)\1/)?.[2],
    checks:tags.filter(tag=>tag.startsWith('@check:')), statuses:tags.filter(tag=>tag.startsWith('@status:')),
    execution:tags.filter(tag=>tag.startsWith('@execution:')),
    file:relative(root,file).replaceAll('\\','/'), categories:tags.filter(t=>t.startsWith('@test:')).map(t=>t.slice(6)),
    variants:tags.filter(t=>t.startsWith('@variant:')).map(t=>t.slice(9)), scenarios};
}));
// Empty entries explicitly retain infrastructure/retired journeys; do not invent
// product pairs. Per-block tags, not this category union, drive PR matching.
export const SCENARIO_COVERAGE = CATEGORIES.map(({id}) => {
  const tests = SCENARIO_TESTS.filter(test=>test.categories.includes(id));
  const pairs = new Map(tests.flatMap(test=>test.scenarios).map(pair=>[scenarioKey(pair),pair]));
  return {category:id,scenarios:[...pairs.values()].sort((a,b)=>scenarioKey(a).localeCompare(scenarioKey(b))),tests};
});

// Current PR browser lanes run Lite regression + render. A pair covered only
// in another variant/project cannot authorize a silently empty PR selection.
export const PR_TEST_PROJECTS = ['insert','feedback','syntax-validation','fullscreen','agent-link','asyncapi','render'];
export function hasPrCoverage(pair) {
  return API_LANES.some(lane => lane.scenarios.some(candidate => scenarioKey(candidate) === scenarioKey(pair))) || SCENARIO_TESTS.some(test => isDefaultPrSpec(test.file) && !test.statuses.includes('@status:retired') && test.variants.includes('lite') && PR_TEST_PROJECTS.includes(test.file.split('/')[0])
    && test.scenarios.some(candidate=>scenarioKey(candidate)===scenarioKey(pair)));
}
