import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { PROJECT_DEPENDENCIES } from '../../tests/e2e-tests/config/project-dependencies.mjs';
import { CATEGORY_VERSION, CATEGORIES, VARIANTS } from '../../tests/e2e-tests/config/categories.mjs';
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createPlan({selection, discovery, variant, tree, policy, shards = 1, changedFiles = [], scope = 'all', legacyGrep = ''}) {
  if (!VARIANTS.includes(variant) || !tree || !policy) throw new Error('variant, tree and policy are required');
  if (discovery.errors?.length) throw new Error('Playwright discovery failed');
  const projects = discovery.config?.projects ?? [];
  const dependencies = {...PROJECT_DEPENDENCIES, ...Object.fromEntries(projects.filter(p => Array.isArray(p.dependencies)).map(p => [p.name, p.dependencies]))};
  const tests = [];
  function walk(suites, parents = []) {
    for (const suite of suites ?? []) {
      const titles = [...parents, suite.title];
      for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) {
        const project = t.projectName;
        if (['auth','pages','preview'].includes(project)) continue;
        tests.push({id: spec.id, file: spec.file ?? suite.file, line: spec.line, title: [...titles.slice(1), spec.title].filter(Boolean).join(' › '), title_path: [...titles.slice(1), spec.title].filter(Boolean), project, tags: (spec.tags ?? []).map(t=>t.startsWith('@')?t:`@${t}`), serial_group: (spec.file ?? suite.file), dependencies: dependencies[project] ?? []});
      }
      walk(suite.suites, titles);
    }
  }
  walk(discovery.suites);
  if (tests.some(t => !t.id || !t.file || !t.project) || new Set(tests.map(t=>t.id)).size !== tests.length) throw new Error('Invalid test identities');
  const known = new Set(CATEGORIES.map(c => c.id));
  if (tests.some(t => !t.tags.some(x => x.startsWith('@variant:')) || t.tags.filter(x => x.startsWith('@variant:')).some(x => !VARIANTS.includes(x.slice(9))))) throw new Error('Invalid or missing variant applicability');
  const reasons = [];
  if (!selection || selection.schema_version !== 1 || selection.tested_tree !== tree || selection.category_version !== CATEGORY_VERSION || selection.policy_version !== policy) reasons.push('invalid-or-stale-selection');
  if (Object.keys(selection?.categories ?? {}).some(c => !known.has(c))) reasons.push('unknown-category');
  if (tests.some(t => !t.tags.some(x => x.startsWith('@test:') && known.has(x.slice(6))) || !t.tags.some(x => VARIANTS.includes(x.replace('@variant:', ''))))) reasons.push('incomplete-inventory');
  const applicable = tests.filter(t => t.tags.includes(`@variant:${variant}`));
  if (['all','insert','asyncapi'].includes(scope) && !applicable.some(t => t.tags.includes('@smoke'))) throw new Error(`No smoke tests for ${variant}`);
  // Guarded activation already resolved the union into discovery's grep.
  // Raw Jev categories must never re-filter away the deterministic floor
  // (or the deliberately widened auxiliary scope).
  const full = policy === 'v2-guarded-uncalibrated' || reasons.length > 0 || selection.mode === 'all' || selection.execution_mode !== 'enabled';
  const selected = applicable.filter(t => full || t.tags.includes('@smoke') || [...changedFiles, ...(selection?.changed_tests ?? [])].some(f => f.endsWith(t.file)) || t.tags.some(tag => tag.startsWith('@test:') && selection.categories?.[tag.slice(6)]?.selected));
  // File groups conservatively retain serial suites and file-scoped shared state.
  if (!selected.length) throw new Error('Empty test plan');
  selected.forEach(t => { t.execution_tier = t.tags.includes('@smoke') ? 'smoke' : 'regression'; });
  const groups = new Map();
  for (const t of selected) {const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/e2e-tests/tests', t.file); const parallel = fs.existsSync(sourcePath) && /test\.describe\.configure\(\{\s*mode:\s*['"]parallel['"]/.test(fs.readFileSync(sourcePath,'utf8')); const key = parallel ? t.id : `${t.project}:${t.serial_group}`; groups.set(key, [...(groups.get(key) ?? []), t]);}
  const buckets = Array.from({length: Math.min(Math.max(1, Number(shards) || 1), groups.size)}, () => []);
  for (const group of [...groups.values()].sort((a,b) => b.length-a.length || a[0].file.localeCompare(b[0].file))) buckets.sort((a,b)=>a.length-b.length)[0].push(...group);
  const requiredProjects = new Set();
  function dependency(p) { for (const d of dependencies[p] ?? []) { if (!requiredProjects.has(d)) {requiredProjects.add(d); dependency(d);} } }
  selected.forEach(t => dependency(t.project));
  const plan = {schema_version:1, tested_tree:tree, category_version:CATEGORY_VERSION, policy_version:policy, variant, scope, coverage:full && !legacyGrep?'full':'selected', legacy_grep:legacyGrep, fallback_reason:reasons.join(',') || selection.fallback_reason || null, dependencies:[...requiredProjects].sort(), tests:selected, shards:buckets.map((tests,i)=>({index:i+1, test_ids:tests.map(t=>t.id), projects:[...new Set(tests.map(t=>t.project))], files:[...new Set(tests.map(t=>t.file))]}))};
  return {...plan, plan_fingerprint:fingerprint(plan)};
}
function args(argv) {return Object.fromEntries(argv.reduce((a,x,i)=> x.startsWith('--') ? [...a,[x.slice(2),argv[i+1]]] : a, []));}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a=args(process.argv.slice(2));
  const plan=createPlan({selection:a.selection?JSON.parse(fs.readFileSync(a.selection)):null,discovery:JSON.parse(fs.readFileSync(a.discovery)),variant:a.variant,tree:a.tree,policy:a.policy,shards:a.shards,scope:a.scope,legacyGrep:a['legacy-grep']});
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `shard-matrix=${JSON.stringify(plan.shards.map(s=>s.index))}\nshard-count=${plan.shards.length}\n`);
  fs.writeFileSync(a.output ?? 'test-plan.json',JSON.stringify(plan,null,2));
}
