import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveSelection } from '../../scripts/test-selection/resolve.mjs';
import { createPlan } from '../../scripts/test-selection/plan.mjs';
import { POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../e2e-tests/config/categories.mjs';
const cwd = resolve('tests/e2e-tests');
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const selection = { schema_version: 1, head_sha: head, tested_tree: tree, category_version: CATEGORY_VERSION, policy_version: POLICY_VERSION, mode: 'selected', execution_mode: 'enabled', diff_complete: true, required: ['smoke'], request: { outcome: 'success' }, categories: Object.fromEntries(CATEGORIES.map(c => [c.id, { probability: c.id === 'sequence' ? 0.9 : 0, selected: c.id === 'sequence' }])) };
const resolved = resolveSelection({ selection, files: ['src/export.js'], head, tree });
it('Playwright category grep selects sequence without its separately classified edit/create/render families', () => {
  const grep = resolved.jev_grep ?? resolved.jev_categories.join('|');
  const discovery = JSON.parse(execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json', '--project=insert', '--project=fullscreen', '--grep=' + grep], { cwd, env: { ...process.env, APP: 'zenuml-lite@stg' }, encoding: 'utf8' }));
  const plan = createPlan({ selection, discovery, variant: 'lite', tree, policy: POLICY_VERSION, scope: 'render' });
  expect(plan.tests.length).toBeGreaterThan(0);
  expect(plan.tests.every(t => t.tags.includes('@test:sequence'))).toBe(true);
});
it('retains the independently widened legacy render inventory when Jev matches only sequence render', () => {
  const temp = mkdtempSync(join(tmpdir(), 'selection-floor-'));
  try {
    const renderSelection = { ...selection, categories: Object.fromEntries(CATEGORIES.map(c => [c.id, { probability: c.id === 'sequence-render' ? 0.9 : 0, selected: c.id === 'sequence-render' }])) };
    const renderResolved = resolveSelection({ selection: renderSelection, files: ['src/export.js'], head, tree });
    writeFileSync(join(temp, 'selection.json'), JSON.stringify(renderSelection));
    writeFileSync(join(temp, 'resolved.json'), JSON.stringify(renderResolved));
    execFileSync('node', ['../../scripts/test-selection/prepare-plan.mjs'], { cwd, env: { ...process.env, APP: 'zenuml-lite@stg', TEST_SUITE: 'render', LEGACY_GREP: renderResolved.grep, SELECTION_PATH: join(temp, 'selection.json'), RESOLVED_SELECTION_PATH: join(temp, 'resolved.json'), PLAN_PATH: join(temp, 'plan.json'), METRICS_PATH: join(temp, 'metrics.json') }, encoding: 'utf8' });
    const plan = JSON.parse(readFileSync(join(temp, 'plan.json'), 'utf8'));
    expect(plan.tests).toHaveLength(19);
    expect(plan.selection_metrics.legacy_count).toBe(19);
    expect(plan.selection_metrics.missing_floor_ids).toEqual([]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
