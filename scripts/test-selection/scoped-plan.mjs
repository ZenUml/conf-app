import { createPlan, fingerprint } from './plan.mjs';
import { categoryGrep, decisionError } from './resolve.mjs';
import { CATEGORIES } from '../../tests/e2e-tests/config/categories.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../tests/e2e-tests/config/impact-map.mjs';
import { EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from './classify.mjs';

// Discovery is performed independently for each filter. In particular, an
// empty auxiliary legacy scope widens before its IDs become the safety floor.
export function scopedPlan({ discover, selection, resolved, head, tree, policy, variant, scope, shards, grep = '' }) {
  const options = { selection, variant, tree, policy, scope, shards };
  const fullDiscovery = discover('');
  const full = createPlan({ ...options, discovery: fullDiscovery });
  const ids = plan => plan.tests.map(t => t.id);
  const chosen = CATEGORIES.filter(c => selection?.categories?.[c.id]?.selected).map(c => `@test:${c.id}`);
  const validSelection = !decisionError({ selection, head, tree }) && selection.policy_version === policy;
  const validResolvedIdentity = resolved?.mode === 'selected'
    && resolved.head_sha === head && resolved.tested_tree === tree
    && resolved.policy_version === policy
    && resolved.selector_catalog_version === EXECUTION_SELECTOR_CATALOG_VERSION
    && resolved.selector_catalog_fingerprint === EXECUTION_SELECTOR_CATALOG_FINGERPRINT
    && grep === resolved.grep;
  const validReasons = Array.isArray(resolved?.reasons)
    && resolved.reasons.every(reason => typeof reason === 'string');
  const validSourcePaths = Array.isArray(resolved?.source_paths)
    && resolved.source_paths.length > 0
    && resolved.source_paths.every(path => typeof path === 'string' && path.length > 0);
  const validFloor = Array.isArray(resolved?.deterministic_tags)
    && resolved.deterministic_tags.includes('@smoke')
    && resolved.deterministic_tags.every(tag => typeof tag === 'string' && /^@[a-zA-Z0-9:_-]+$/.test(tag))
    && resolved.deterministic_grep === resolved.deterministic_tags.join('|');
  const validCategories = Array.isArray(resolved?.jev_categories)
    && resolved.jev_categories.length > 0
    && JSON.stringify(resolved.jev_categories) === JSON.stringify(chosen)
    && resolved.jev_grep === categoryGrep(resolved.jev_categories);
  const validCombinedFilter = validFloor && validCategories
    && resolved.grep === [...resolved.deterministic_tags, resolved.jev_grep].join('|');
  const valid = !full.fallback_reason && validSelection && validResolvedIdentity
    && validReasons && validSourcePaths && validFloor && validCategories && validCombinedFilter;
  // A nonempty filter without a verified resolved artifact must not narrow.
  // Main/nightly and fail-full runs therefore retain the entire scope.
  let legacy = full, jev = null, final = full;
  if (valid) {
    const make = filter => createPlan({ ...options, discovery: discover(filter), legacyGrep: filter });
    legacy = make(resolved.deterministic_tags.join('|'));
    jev = make(['@smoke', resolved.jev_grep].join('|'));
    final = createPlan({ ...options, discovery: fullDiscovery, testIds: [...new Set([...ids(legacy), ...ids(jev)])], legacyGrep: grep });
  }
  const finalIds = new Set(ids(final));
  const missing = ids(legacy).filter(id => !finalIds.has(id));
  if (missing.length) throw new Error('Legacy scope coverage was lost');
  const metrics = { schema_version: 1, policy_version: policy, tested_tree: tree, variant, scope, mode: valid ? 'selected' : 'all', source_paths: valid ? resolved.source_paths : [], deterministic_behavior_selectors: valid ? resolved.deterministic_tags : [], jev_behavior_selectors: valid ? resolved.jev_categories : [], full_count: full.tests.length, legacy_count: legacy.tests.length, jev_count: jev?.tests.length ?? null, final_count: final.tests.length, final_test_ids: ids(final), smoke_count: final.tests.filter(t => t.tags.includes('@smoke')).length, missing_floor_ids: missing, added_to_legacy_ids: ids(final).filter(id => !new Set(ids(legacy)).has(id)), retained_from_legacy_ids: jev ? ids(legacy).filter(id => !new Set(ids(jev)).has(id)) : [], reasons: Array.isArray(resolved?.reasons) && resolved.reasons.every(reason => typeof reason === 'string') ? resolved.reasons : ['missing-or-malformed-resolved-selection'], fallback_reason: valid ? null : full.fallback_reason || selection?.fallback_reason || 'selection-not-authorized', model: selection?.model ?? null, request: selection?.request ?? { outcome: 'not-requested' }, measurement: 'planned-test-counts; timing is reported separately in test-evidence.json' };
  const { plan_fingerprint: ignored, ...body } = final;
  const plan = { ...body, selection_metrics: metrics };
  return { ...plan, plan_fingerprint: fingerprint(plan) };
}
export function metricsSummary(metrics) {
  return `### Test selection (${metrics.variant}, ${metrics.scope})\n\n| Full inventory | Deterministic floor | Smoke + Jev | Final plan |\n|---:|---:|---:|---:|\n| ${metrics.full_count} | ${metrics.legacy_count} | ${metrics.jev_count ?? 'not applied'} | ${metrics.final_count} |\n\nSource paths: ${metrics.source_paths.join(', ') || 'not available (full fallback)'}.\nDeterministic selectors: ${metrics.deterministic_behavior_selectors.join(', ') || 'full fallback'}. Jev selectors: ${metrics.jev_behavior_selectors.join(', ') || 'not applied'}.\nSmoke: ${metrics.smoke_count}; missing floor IDs: ${metrics.missing_floor_ids.length}.\nAPI: ${metrics.request.outcome}; model: ${metrics.model ?? 'not requested'}; classification: ${metrics.request.duration_ms ?? 0} ms.\nFallback: ${metrics.fallback_reason ?? 'none'}. Reasons: ${metrics.reasons.join(', ')}.\n\nConcrete execution and scheduler timing are reported separately in test-evidence.json.\n`;
}
