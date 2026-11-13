import process from 'node:process';
import { createHash } from 'node:crypto';
import { SCENARIO_COVERAGE, API_LANES, hasPrCoverage } from '../../tests/e2e-tests/config/scenario-coverage.mjs';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { select, selectAgentFloor } from '../e2e-select.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../../tests/e2e-tests/config/categories.mjs';
import { CATEGORY_SELECTION_THRESHOLD, POLICY_VERSION, EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from './classify.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../tests/e2e-tests/config/impact-map.mjs';
import { dependencyTagsForScenarios } from '../../tests/e2e-tests/config/scenario-dependencies.mjs';
import { validScenarios, scenarioKey, scenarioTag, PRODUCT_IMPACT_FINGERPRINT } from '../../tests/e2e-tests/config/product-impact.mjs';

export const categoryGrep = categories => categories.map(tag => `(?:^|\\s)${tag}(?=\\s|$)`).join('|');

export function decisionError({ selection, head, tree }) {
  if (!selection || selection.schema_version !== 1 || selection.head_sha !== head || selection.tested_tree !== tree || selection.policy_version !== POLICY_VERSION || selection.category_version !== CATEGORY_VERSION || selection.selector_catalog_version !== EXECUTION_SELECTOR_CATALOG_VERSION || selection.selector_catalog_fingerprint !== EXECUTION_SELECTOR_CATALOG_FINGERPRINT) return selection?.decision_source === 'agent' ? 'invalid-or-stale-agent-selection' : 'invalid-or-stale-jev-selection';
  if (selection.decision_source === 'agent') return agentDecisionError(selection);
  if (selection.execution_mode !== 'enabled' || selection.mode !== 'selected' || selection.fallback_reason || selection.diff_complete !== true || selection.request?.outcome !== 'success' || (!Array.isArray(selection.required) || !selection.required.includes('smoke'))) return 'jev-full-fallback';
  const categories = selection.categories;
  if (!categories || typeof categories !== 'object' || Array.isArray(categories) || Object.keys(categories).length !== CATEGORIES.length || CATEGORIES.some(c => {
    const a = categories[c.id];
    return !a || typeof a.probability !== 'number' || !Number.isFinite(a.probability) || a.probability < 0 || a.probability > 1 || a.selected !== (a.probability >= CATEGORY_SELECTION_THRESHOLD);
  })) return 'invalid-jev-categories';
  const chosen = Object.values(categories).some(c => c.selected);
  if (!chosen && selection.selection_scope !== 'main') return 'empty-or-uncertain-jev-selection';
  return null;
}

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const structuralScenarios = value => Array.isArray(value) && value.every(pair => pair && typeof pair === 'object' && Object.keys(pair).sort().join(',') === 'feature,interface' && typeof pair.feature === 'string' && typeof pair.interface === 'string' && /^[a-z0-9-]+$/.test(pair.feature) && /^[a-z0-9-]+$/.test(pair.interface)) && new Set(value.map(scenarioKey)).size === value.length;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function agentDecisionError(selection) {
  if (!fingerprint(selection.scenario_coverage_fingerprint) || !fingerprint(selection.product_impact_fingerprint) || selection.decision_schema_version !== 2 || !structuralScenarios(selection.scenarios)
      || selection.selection_scope !== 'pr' || selection.execution_mode !== 'enabled'
      || !['selected', 'all'].includes(selection.mode) || selection.fallback_reason
      || selection.diff_complete !== true || (!Array.isArray(selection.required) || !selection.required.includes('smoke'))
      || !Number.isSafeInteger(selection.decision_id) || selection.decision_id < 1
      || !Number.isSafeInteger(selection.pr_number) || selection.pr_number < 1
      || !sha(selection.pr_head_sha) || !sha(selection.base_sha)
      || !['labeling', 'triage'].includes(selection.source)
      || !Array.isArray(selection.source_paths) || !selection.source_paths.length
      || selection.source_paths.some(path => !nonempty(path) || /[\r\n]/.test(path))
      || !Array.isArray(selection.removed_paths) || selection.removed_paths.some(path => !selection.source_paths.includes(path))) return 'invalid-agent-decision';
  if (selection.mode === 'selected' && (selection.product_impact_fingerprint !== PRODUCT_IMPACT_FINGERPRINT || selection.scenario_coverage_fingerprint !== createHash('sha256').update(JSON.stringify({ browser: SCENARIO_COVERAGE, api: API_LANES })).digest('hex') || !validScenarios(selection.scenarios))) return 'invalid-agent-decision';
  if (selection.mode === 'selected' && selection.scenarios.some(pair => !hasPrCoverage(pair))) return 'scenario-without-e2e-coverage';
  if (selection.mode === 'all' && (selection.source !== 'triage' || !nonempty(selection.full_reason))) return 'full-requires-triage';
  const categories = selection.categories;
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)
      || Object.keys(categories).length !== CATEGORIES.length
      || CATEGORIES.some(c => categories[c.id]?.selected !== false)) return 'invalid-agent-categories';
  return null;
}

export function resolveAgentSelection({ selection, files, head, tree }) {
  const invalid = decisionError({ selection, head, tree });
  if (invalid || selection?.decision_source !== 'agent') throw new Error(`PR test decision blocked: ${invalid || 'missing-agent-decision'}`);
  if (!Array.isArray(files) || JSON.stringify([...files].sort()) !== JSON.stringify([...selection.source_paths].sort())) throw new Error('PR test decision blocked: changed paths differ');
  const floor = selectAgentFloor(files, { removedPaths: selection.removed_paths });
  const chosen = selection.mode === 'all' ? [] : selection.scenarios.map(scenarioTag);
  const dependencies = selection.mode === 'all' ? [] : dependencyTagsForScenarios(selection.scenarios, { directFiles: floor.direct_test_files, floorTags: floor.tags });
  const agentGrep = categoryGrep([...chosen, ...dependencies]);
  return {
    mode: selection.mode, selection_scope: 'pr', decision_source: 'agent', decision_id: selection.decision_id,
    pr_number: selection.pr_number, pr_head_sha: selection.pr_head_sha, base_sha: selection.base_sha,
    head_sha: head, tested_tree: tree, policy_version: POLICY_VERSION,
    selector_catalog_version: EXECUTION_SELECTOR_CATALOG_VERSION, selector_catalog_fingerprint: EXECUTION_SELECTOR_CATALOG_FINGERPRINT,
    source_paths: [...files], removed_paths: [...selection.removed_paths], direct_test_files: floor.direct_test_files,
    deterministic_tags: floor.tags, deterministic_grep: floor.tags.join('|'),
    agent_categories: dependencies, agent_scenarios: selection.scenarios, agent_scenario_tags: chosen, agent_grep: agentGrep,
    decision_schema_version: 2, product_impact_fingerprint: selection.product_impact_fingerprint, scenario_coverage_fingerprint: selection.scenario_coverage_fingerprint,
    tags: selection.mode === 'all' ? [] : [...new Set([...floor.tags, ...chosen, ...dependencies])].sort(),
    grep: selection.mode === 'all' ? '' : [...floor.tags, ...(agentGrep ? [agentGrep] : [])].join('|'),
    reasons: selection.mode === 'all' ? ['triage-approved-full', selection.full_reason] : ['agent-selected-scenarios', ...floor.reasons],
  };
}

// Jev can add coverage, but cannot remove the established deterministic floor.
// The high-confidence threshold is a precision policy, not a calibration claim.
export function resolveSelection({ selection, files, head, tree, humanFull = false, scope = 'pr' }) {
  if (selection?.decision_source === 'agent') return resolveAgentSelection({ selection, files, head, tree });
  const source_paths = Array.isArray(files) ? [...files] : [];
  const full = reason => ({ mode: 'all', tags: [], grep: '', reasons: [reason], source_paths, direct_test_files: [], policy_version: POLICY_VERSION });
  if (humanFull) return full('human-test-all');
  if (scope === 'main' && selection?.selection_scope !== 'main') return full('invalid-main-selection-scope');
  const floor = select(files, { scope });
  if (floor.mode === 'all') return full('deterministic-full-fallback');
  const invalid = decisionError({ selection, head, tree });
  if (invalid) return full(invalid);
  const chosen = CATEGORIES.filter(c => selection.categories[c.id].selected).map(c => `@test:${c.id}`);
  if (!chosen.length && scope !== 'main') return full('empty-jev-selection');
  const tags = [...new Set(['@smoke', ...floor.tags, ...chosen])].sort();
  const jevGrep = categoryGrep(chosen);
  return { mode: 'selected', selection_scope: scope, tags, grep: [...floor.tags, ...(jevGrep ? [jevGrep] : [])].join('|'), jev_grep: jevGrep, deterministic_grep: floor.tags.join('|'), reasons: ['smoke-required', 'deterministic-coverage-floor', ...floor.reasons, 'jev-selected-categories'], source_paths, direct_test_files: floor.direct_test_files, policy_version: POLICY_VERSION, selector_catalog_version: EXECUTION_SELECTOR_CATALOG_VERSION, selector_catalog_fingerprint: EXECUTION_SELECTOR_CATALOG_FINGERPRINT, head_sha: head, tested_tree: tree, jev_categories: chosen, deterministic_tags: floor.tags };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let selection = null;
  try { selection = JSON.parse(readFileSync(process.env.SELECTION_PATH || 'test-selection.json', 'utf8')); } catch { /* Missing or malformed artifacts fail full. */ }
  const files = readFileSync('changed-files.txt', 'utf8').split('\n').filter(Boolean);
  const result = resolveSelection({ selection, files, head: process.env.CANDIDATE, tree: process.env.CANDIDATE_TREE, humanFull: process.env.HUMAN_FULL === 'true', scope: process.env.SELECTION_SCOPE || 'pr' });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\ngrep=${result.grep}\n`);
}
