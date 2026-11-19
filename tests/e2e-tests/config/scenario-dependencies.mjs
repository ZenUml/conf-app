import { CATEGORIES } from './categories.mjs';
import { SCENARIO_COVERAGE, SCENARIO_TESTS } from './scenario-coverage.mjs';
import { scenarioKey, validScenarios } from './product-impact.mjs';

// Pair matching never selects a whole legacy category. Only its established
// dependencies form an additional floor, retaining the existing safety policy.
export function dependencyTagsForScenarios(scenarios, { directFiles = [], floorTags = [] } = {}) {
  if (!validScenarios(scenarios)) throw new Error('Invalid product impact scenarios');
  const keys = new Set(scenarios.map(scenarioKey));
  const byId = new Map(CATEGORIES.map(category => [category.id, category]));
  const dependencies = new Set();
  const visit = id => {
    if (!byId.has(id)) throw new Error(`Unknown E2E dependency: ${id}`);
    for (const dependency of byId.get(id).dependencies ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  for (const item of SCENARIO_TESTS) if (directFiles.includes(item.file)) item.categories.forEach(visit);
  for (const tag of floorTags) if (tag.startsWith('@test:')) visit(tag.slice(6));
  for (const item of SCENARIO_COVERAGE) if (item.scenarios.some(pair => keys.has(scenarioKey(pair)))) visit(item.category);
  return [...dependencies].sort().map(id => `@test:${id}`);
}
