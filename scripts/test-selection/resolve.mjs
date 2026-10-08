import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { select } from '../e2e-select.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../../tests/e2e-tests/config/categories.mjs';
import { CATEGORY_SELECTION_THRESHOLD, POLICY_VERSION, EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from './classify.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../tests/e2e-tests/config/impact-map.mjs';

export const categoryGrep = categories => categories.map(tag => `(?:^|\\s)${tag}(?=\\s|$)`).join('|');

export function decisionError({ selection, head, tree }) {
  if (!selection || selection.schema_version !== 1 || selection.head_sha !== head || selection.tested_tree !== tree || selection.policy_version !== POLICY_VERSION || selection.category_version !== CATEGORY_VERSION || selection.selector_catalog_version !== EXECUTION_SELECTOR_CATALOG_VERSION || selection.selector_catalog_fingerprint !== EXECUTION_SELECTOR_CATALOG_FINGERPRINT) return 'invalid-or-stale-jev-selection';
  if (selection.execution_mode !== 'enabled' || selection.mode !== 'selected' || selection.fallback_reason || selection.diff_complete !== true || selection.request?.outcome !== 'success' || (!Array.isArray(selection.required) || !selection.required.includes('smoke'))) return 'jev-full-fallback';
  const categories = selection.categories;
  if (!categories || typeof categories !== 'object' || Array.isArray(categories) || Object.keys(categories).length !== CATEGORIES.length || CATEGORIES.some(c => {
    const a = categories[c.id];
    return !a || typeof a.probability !== 'number' || !Number.isFinite(a.probability) || a.probability < 0 || a.probability > 1 || a.selected !== (a.probability >= CATEGORY_SELECTION_THRESHOLD);
  })) return 'invalid-jev-categories';
  const chosen = Object.values(categories).some(c => c.selected);
  if (!chosen && !(selection.selection_scope === 'main' && selection.no_additional_impact === true && Object.values(categories).every(c => c.probability < 0.1))) return 'empty-or-uncertain-jev-selection';
  return null;
}

// Jev can add coverage, but cannot remove the established deterministic floor.
// The high-confidence threshold is a precision policy, not a calibration claim.
export function resolveSelection({ selection, files, head, tree, humanFull = false, scope = 'pr' }) {
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
