import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canReuse } from './evidence.mjs';
import { fingerprint } from './plan.mjs';
import { CATEGORY_VERSION } from '../../tests/e2e-tests/config/categories.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../tests/e2e-tests/config/impact-map.mjs';
import { EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from './classify.mjs';
import { POLICY_VERSION } from './classify.mjs';

export function validateReuse({ plan, evidence, tree, scope }) {
  const { plan_fingerprint, ...body } = plan;
  return plan.schema_version === 1 && plan.coverage === 'full' && plan.variant === 'lite'
    && plan.scope === scope && plan.tested_tree === tree && plan.tests.length > 0
    && plan.category_version === CATEGORY_VERSION && plan.policy_version === POLICY_VERSION
    && plan.selector_catalog_version === EXECUTION_SELECTOR_CATALOG_VERSION
    && plan.selector_catalog_fingerprint === EXECUTION_SELECTOR_CATALOG_FINGERPRINT
    && fingerprint(body) === plan_fingerprint && canReuse(evidence, plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, tree] = process.argv.slice(2);
  const scopes = ['insert', 'graph-publish', 'render'];
  for (const scope of scopes) {
    const suffix = scope === 'insert' ? 'lite-stg' : `lite-stg-${scope}`;
    const planFolder = join(directory, `test-plan-${suffix}`);
    const evidenceFolder = join(directory, `test-evidence-${suffix}`);
    try {
      const plan = JSON.parse(readFileSync(join(planFolder, 'test-plan.json')));
      const evidence = JSON.parse(readFileSync(join(evidenceFolder, 'test-evidence.json')));
      if (!validateReuse({ plan, evidence, tree, scope })) throw new Error('invalid evidence');
    } catch { console.error(`No reusable concrete evidence for ${scope}`); process.exit(1); }
  }
  console.log('Exact-tree full Lite test evidence verified');
}
