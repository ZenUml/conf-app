import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandedSteps } from './workflow-steps.mjs';

for (const name of ['pr-validation', 'main-build-preparation']) {
  test(`${name} gates on the offline Mixpanel browser regression with installed Chromium`, () => {
    const steps = expandedSteps(name, 'preview-e2e');
    const index = stepName => steps.findIndex(step => step.name === stepName);
    const isolation = index('Verify Mixpanel isolation without network egress');
    assert.ok(isolation >= 0);
    for (const required of ['Install E2E test dependencies', 'Cache Playwright browsers', 'Install Playwright browsers', 'Run preview specs against a local Vite dev server']) {
      assert.ok(index(required) >= 0, `${required} is present`);
    }
    assert.ok(index('Install E2E test dependencies') < isolation);
    assert.ok(index('Cache Playwright browsers') < isolation);
    assert.ok(index('Install Playwright browsers') < isolation);
    assert.ok(isolation < index('Run preview specs against a local Vite dev server'));
    assert.equal(steps[isolation].run,
      'cd tests/e2e-tests && pnpm exec playwright test -c playwright.mixpanel-isolation.config.ts');
  });
}
