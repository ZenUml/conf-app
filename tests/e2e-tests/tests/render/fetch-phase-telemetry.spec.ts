import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { getPageId } from '../../utils/page-registry.js';
import { captureMixpanelEvents } from '../../helpers/macroViewedCapture.js';
import { MacroPage } from '../../pages/MacroPage.js';

/**
 * #413 end-to-end guard.
 *
 * `fetch_ms` on `macro_viewed` used to be recorded by forgeIndex, which loaded
 * the doc for every macro type. When that redundant load was correctly gated to
 * the sequence family (v2026.07.250749), graph and openapi — the two slowest
 * macro types — silently lost the phase, and openapi lost
 * `custom_content_fetch_ms` / `page_adf_fetch_ms` as well because it reported
 * `macro_viewed` from `mounted()`, before its own load had even started.
 *
 * Nothing in the suite noticed for four days. The unit guards cover the two
 * mechanisms in isolation; this asserts the payload a REAL render actually puts
 * on the wire, which is the only place the two halves meet.
 */
test.describe.configure({ mode: 'serial' });

const CASES = [
  { macroType: 'graph' as const, expectFetchChildren: true },
  { macroType: 'openapi' as const, expectFetchChildren: true },
];

test.describe('macro_viewed fetch phase', () => {
  for (const { macroType, expectFetchChildren } of CASES) {
    test(`${macroType} reports fetch_ms for a real viewer render`, async ({ page, context }) => {
      test.skip(
        !testConfig.renderMacros.includes(macroType),
        `${macroType} is not rendered by this variant`,
      );

      // Attach BEFORE navigating: the render — and its event — happen during load.
      const captured = captureMixpanelEvents(context);

      await page.goto(testConfig.pageUrl(getPageId(macroType)));
      await expect(page.locator('#title-text')).toBeVisible();
      await new MacroPage(page).dismissSpotlightModal();

      await expect
        .poll(() => captured.forMacro(macroType).length, { timeout: 90_000 })
        .toBeGreaterThan(0);

      const events = captured.forMacro(macroType);
      // One render, one event. A second would mean a remount storm, which would
      // also make every duration percentile wrong.
      expect(events, `${macroType} should report exactly one macro_viewed`).toHaveLength(1);

      const props = events[0].properties;
      expect(props.surface).toBe('viewer');
      // Graph and OpenAPI macro keys are NOT variant-suffixed the way the
      // sequence macro is, so on a multi-install site (zenuml.atlassian.net
      // carries Lite, Full and Diagramly at once) an API-created macro can be
      // rendered by a sibling app. Without this the test can pass against a
      // variant that never shipped the change under test.
      expect(
        props.product_type,
        `this render came from the ${props.product_type} app, not ${testConfig.productType}`,
      ).toBe(testConfig.productType);
      expect(
        typeof props.duration_ms,
        'duration_ms is the headline metric and must always be present',
      ).toBe('number');
      expect(
        typeof props.fetch_ms,
        'fetch_ms went dark for four days when its owner changed — this is the tripwire',
      ).toBe('number');

      if (expectFetchChildren) {
        expect(
          typeof props.custom_content_fetch_ms,
          'the custom-content GET must be attributed inside fetch_ms',
        ).toBe('number');
      }
    });
  }
});
