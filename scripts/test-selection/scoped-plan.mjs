import { createPlan, fingerprint } from './plan.mjs';
import { categoryGrep, decisionError, resolveAgentSelection } from './resolve.mjs';
import { CATEGORIES } from '../../tests/e2e-tests/config/categories.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../tests/e2e-tests/config/impact-map.mjs';
import { EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from './classify.mjs';

const scopeProjects = {
  all: null,
  insert: new Set(['insert', 'feedback']),
  render: new Set(['render']),
  fullscreen: new Set(['fullscreen']),
  'graph-publish': new Set(['fullscreen']),
  asyncapi: new Set(['asyncapi']),
  'regression-render': new Set(['render']),
  regression: new Set(['insert', 'feedback', 'syntax-validation', 'fullscreen', 'agent-link', 'asyncapi']),
};
const inScope = (file, scope) => {
  const projects = scopeProjects[scope];
  if (projects === undefined || projects === null || !file.includes('/')) return true;
  return projects.has(file.split('/')[0]);
};

// Discovery is performed independently for each filter. In particular, an
// empty auxiliary legacy scope widens before its IDs become the safety floor.
export function scopedPlan({ discover, selection, resolved, head, tree, policy, variant, scope, shards, grep = '', sourcePaths = [], selectionScope = 'pr', requireAgentDecision = false, inventoryProjects = null }) {
  if (requireAgentDecision || selection?.decision_source === 'agent') return agentScopedPlan({ discover, selection, resolved, head, tree, policy, variant, scope, shards, grep, sourcePaths, selectionScope, inventoryProjects });
  const options = { selection, variant, tree, policy, scope, shards };
  const fullDiscovery = discover('');
  const full = createPlan({ ...options, discovery: fullDiscovery });
  const ids = plan => plan.tests.map(t => t.id);
  const chosen = CATEGORIES.filter(c => selection?.categories?.[c.id]?.selected).map(c => `@test:${c.id}`);
  const validScope = selectionScope === 'main'
    ? selection?.selection_scope === 'main' && resolved?.selection_scope === 'main'
    : selectionScope === 'pr' && selection?.selection_scope !== 'main' && resolved?.selection_scope !== 'main';
  const validSelection = validScope && !decisionError({ selection, head, tree }) && selection.policy_version === policy;
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
  const directTestFiles = Array.isArray(resolved?.direct_test_files) ? resolved.direct_test_files : [];
  const directInScope = directTestFiles.filter(file => inScope(file, scope));
  const validDirectTests = Array.isArray(resolved?.direct_test_files)
    && directTestFiles.every(file => typeof file === 'string' && /^(?:[^/]+\/)*[^/]+\.(?:spec|test)\.[cm]?[jt]s$/.test(file))
    && directInScope.every(file => full.tests.some(test => test.file === file));
  const validCategories = Array.isArray(resolved?.jev_categories)
    && (resolved.jev_categories.length > 0 || selection?.selection_scope === 'main')
    && JSON.stringify(resolved.jev_categories) === JSON.stringify(chosen)
    && resolved.jev_grep === categoryGrep(resolved.jev_categories);
  const validCombinedFilter = validFloor && validCategories
    && resolved.grep === [...resolved.deterministic_tags, ...(resolved.jev_grep ? [resolved.jev_grep] : [])].join('|');
  const valid = !full.fallback_reason && validSelection && validResolvedIdentity
    && validReasons && validSourcePaths && validFloor && validDirectTests && validCategories && validCombinedFilter;
  // A nonempty filter without a verified resolved artifact must not narrow.
  // Main/nightly and fail-full runs therefore retain the entire scope.
  let legacy = full, jev = null, final = full;
  if (valid && selection.selection_scope === 'main' && resolved.selection_scope === 'main') {
    // Select concrete IDs from the complete variant inventory, including edit
    // and syntax projects. An empty render plan is legitimate when Jev and
    // direct-spec coverage require no render tests; it must not widen to full.
    legacy = { tests: full.tests.filter(test => test.tags.includes('@smoke')) };
    jev = { tests: full.tests.filter(test => test.tags.includes('@smoke') || test.tags.some(tag => chosen.includes(tag))) };
    const direct = full.tests.filter(test => directInScope.includes(test.file));
    final = createPlan({ ...options, discovery: fullDiscovery, testIds: [...new Set([...ids(legacy), ...ids(jev), ...ids({ tests: direct })])], legacyGrep: grep, allowEmpty: true });
  } else if (valid) {
    const make = filter => createPlan({ ...options, discovery: discover(filter), legacyGrep: filter });
    // The render suite has no @smoke tests. Do not let an empty floor filter
    // fall back to its whole inventory; Jev or direct specs supply its plan.
    legacy = ['render', 'regression-render'].includes(scope)
      ? { tests: [] }
      : make(resolved.deterministic_tags.join('|'));
    jev = make(['@smoke', resolved.jev_grep].join('|'));
    const direct = full.tests.filter(test => directInScope.includes(test.file)).map(test => test.id);
    final = createPlan({ ...options, discovery: fullDiscovery, testIds: [...new Set([...ids(legacy), ...ids(jev), ...direct])], legacyGrep: grep });
  }
  const finalIds = new Set(ids(final));
  const missing = ids(legacy).filter(id => !finalIds.has(id));
  if (missing.length) throw new Error('Legacy scope coverage was lost');
  const fallbackSourcePaths = Array.isArray(sourcePaths) ? sourcePaths.filter(path => typeof path === 'string' && path.length > 0) : [];
  const reportedDirectTestFiles = valid ? directInScope : [];
  const directTestCount = valid ? final.tests.filter(test => reportedDirectTestFiles.includes(test.file)).length : 0;
  const metrics = { schema_version: 1, policy_version: policy, tested_tree: tree, variant, scope, mode: valid ? 'selected' : 'all', source_paths: valid ? resolved.source_paths : fallbackSourcePaths, deterministic_behavior_selectors: valid ? resolved.deterministic_tags : [], direct_test_files: reportedDirectTestFiles, direct_test_count: directTestCount, jev_behavior_selectors: valid ? resolved.jev_categories : [], full_count: full.tests.length, legacy_count: legacy.tests.length, jev_count: jev?.tests.length ?? null, final_count: final.tests.length, final_test_ids: ids(final), smoke_count: final.tests.filter(t => t.tags.includes('@smoke')).length, missing_floor_ids: missing, added_to_legacy_ids: ids(final).filter(id => !new Set(ids(legacy)).has(id)), retained_from_legacy_ids: jev ? ids(legacy).filter(id => !new Set(ids(jev)).has(id)) : [], reasons: Array.isArray(resolved?.reasons) && resolved.reasons.every(reason => typeof reason === 'string') ? resolved.reasons : ['missing-or-malformed-resolved-selection'], fallback_reason: valid ? null : full.fallback_reason || selection?.fallback_reason || 'selection-not-authorized', model: selection?.model ?? null, request: selection?.request ?? { outcome: 'not-requested' }, measurement: 'planned-test-counts; timing is reported separately in test-evidence.json' };
  const body = { ...final };
  delete body.plan_fingerprint;
  const plan = { ...body, selection_metrics: metrics };
  return { ...plan, plan_fingerprint: fingerprint(plan) };
}
// PR agent authorization is fail-closed. It never shares Jev's fail-full path.
function agentScopedPlan({ discover, selection, resolved, head, tree, policy, variant, scope, shards, grep, sourcePaths, selectionScope, inventoryProjects }) {
  if (selectionScope !== 'pr' || selection?.decision_source !== 'agent') throw new Error('PR test decision blocked: missing agent authorization');
  const expected = resolveAgentSelection({ selection, files: sourcePaths, head, tree });
  if (policy !== selection.policy_version || !resolved
      || Object.keys(expected).some(key => JSON.stringify(resolved[key]) !== JSON.stringify(expected[key]))
      || grep !== expected.grep) throw new Error('PR test decision blocked: invalid or stale resolved authorization');
  const options = { selection, variant, tree, policy, scope, shards };
  const discovery = discover('');
  const full = createPlan({ ...options, discovery });
  if (full.fallback_reason) throw new Error(`PR test decision blocked: ${full.fallback_reason}`);
  // A regression plan retains legacy scope 'all', but its actual discovery
  // excludes render. Require each direct spec in the lane that discovers it.
  if (inventoryProjects !== null && (!Array.isArray(inventoryProjects) || inventoryProjects.some(project => typeof project !== 'string' || !project))) throw new Error('PR test decision blocked: invalid inventory projects');
  const discoveredVariants = new Map();
  const collectVariants = suites => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        if (!(spec.tests ?? []).some(test => !['auth', 'pages', 'preview'].includes(test.projectName))) continue;
        const file = spec.file ?? suite.file;
        const variants = discoveredVariants.get(file) ?? new Set();
        for (const tag of spec.tags ?? []) {
          const normalized = tag.startsWith('@') ? tag : `@${tag}`;
          if (normalized.startsWith('@variant:')) variants.add(normalized.slice(9));
        }
        discoveredVariants.set(file, variants);
      }
      collectVariants(suite.suites);
    }
  };
  collectVariants(discovery.suites);
  const direct = expected.direct_test_files.filter(file => (inventoryProjects === null
    ? inScope(file, scope) : inventoryProjects.includes(file.split('/')[0]))
    // A present spec explicitly targeting another variant belongs to that
    // variant's validation. Missing specs still reach the blocking check below.
    && (!discoveredVariants.has(file) || discoveredVariants.get(file).has(variant)));
  if (direct.some(file => !full.tests.some(test => test.file === file))) throw new Error('PR test decision blocked: directly changed spec absent from inventory');
  const floor = full.tests.filter(test => test.tags.some(tag => expected.deterministic_tags.includes(tag)) || direct.includes(test.file));
  const selected = selection.mode === 'all' ? full.tests : full.tests.filter(test => floor.includes(test) || test.tags.some(tag => expected.agent_categories.includes(tag)));
  const final = selection.mode === 'all' ? full : createPlan({ ...options, discovery, testIds: selected.map(test => test.id), legacyGrep: grep, allowEmpty: true });
  const ids = final.tests.map(test => test.id);
  if (floor.some(test => !ids.includes(test.id))) throw new Error('PR test decision blocked: required coverage lost');
  const metrics = {
    schema_version: 1, decision_source: 'agent', decision_id: selection.decision_id,
    policy_version: policy, tested_tree: tree, variant, scope, mode: selection.mode,
    source_paths: sourcePaths, deterministic_behavior_selectors: expected.deterministic_tags,
    direct_test_files: direct, direct_test_count: final.tests.filter(test => direct.includes(test.file)).length,
    agent_behavior_selectors: expected.agent_categories, jev_behavior_selectors: [],
    full_count: full.tests.length, legacy_count: floor.length, jev_count: null,
    final_count: ids.length, final_test_ids: ids, smoke_count: final.tests.filter(test => test.tags.includes('@smoke')).length,
    missing_floor_ids: [], added_to_legacy_ids: ids.filter(id => !floor.some(test => test.id === id)), retained_from_legacy_ids: [],
    reasons: expected.reasons, fallback_reason: null, model: null, request: { outcome: 'not-requested' },
    measurement: 'planned-test-counts; timing is reported separately in test-evidence.json',
  };
  const body = { ...final };
  delete body.plan_fingerprint;
  const plan = { ...body, selection_metrics: metrics };
  return { ...plan, plan_fingerprint: fingerprint(plan) };
}

export function metricsSummary(metrics) {
  if (metrics.decision_source === 'agent') return `### PR test decision (${metrics.variant}, ${metrics.scope})\n\nDecision comment: ${metrics.decision_id}; mode: ${metrics.mode}. Full inventory: ${metrics.full_count}; required floor: ${metrics.legacy_count}; final plan: ${metrics.final_count}.\n\nAgent selectors: ${metrics.agent_behavior_selectors.join(', ') || 'smoke and direct specs only'}. Direct specs: ${metrics.direct_test_files.join(', ') || 'none'}.\n\nReasons: ${metrics.reasons.join(', ')}. No model API request was made. Concrete execution is recorded separately in test-evidence.json.\n`;
  return `### Test selection (${metrics.variant}, ${metrics.scope})\n\n| Full inventory | Deterministic floor | Smoke + Jev | Final plan |\n|---:|---:|---:|---:|\n| ${metrics.full_count} | ${metrics.legacy_count} | ${metrics.jev_count ?? 'not applied'} | ${metrics.final_count} |\n\nSource paths: ${metrics.source_paths.join(', ') || 'not available (full fallback)'}.\nDeterministic selectors: ${metrics.deterministic_behavior_selectors.join(', ') || 'full fallback'}. Direct specs: ${metrics.direct_test_files.join(', ') || 'none'}. Jev selectors: ${metrics.jev_behavior_selectors.join(', ') || 'not applied'}.\nSmoke: ${metrics.smoke_count}; missing floor IDs: ${metrics.missing_floor_ids.length}.\nAPI: ${metrics.request.outcome}; model: ${metrics.model ?? 'not requested'}; classification: ${metrics.request.duration_ms ?? 0} ms.\nFallback: ${metrics.fallback_reason ?? 'none'}. Reasons: ${metrics.reasons.join(', ')}.\n\nConcrete execution and scheduler timing are reported separately in test-evidence.json.\n`;
}
