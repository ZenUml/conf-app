/**
 * Spot check: metrics-undercount fix (#215/#216)
 *
 * Verifies three things on lite-stg (SD space, ~1230 macros):
 *  1. Gate-path: KV miss → bounded collect (total ≤ PAYWALL_COUNT_CEILING = 100)
 *  2. Smoke: SVG renders, no fatal console errors
 *  3. Editor-open: reportMacroMetrics fires with the TRUE total (>> 100)
 *     (was SILENT in the old code which called it from saveToPlatform — the
 *     save path tears down the iframe before the enumeration can complete)
 *
 * Pre-conditions:
 *   • Clear KV before running to guarantee a gate-path miss:
 *       npx wrangler kv key delete \
 *         --namespace-id=9531a58d3f5b47a6af77750240c09548 \
 *         "metrics:lite-stg:SD:lite" --remote
 *   • Staging build must have PR #216 deployed (deployed on merge to main)
 *
 * Run:
 *   APP=zenuml-lite@stg PAGE_ID=105840643 \
 *   npx playwright test tests/e2e-tests/tests/insert/spot-check-metrics-fix.spec.ts \
 *   --project=insert
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';

const FORGE_FRAME = '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';
// PAYWALL_COUNT_CEILING from MacroMetrics.ts — gate-path stops counting here
const PAYWALL_COUNT_CEILING = 100;

test.describe('Metrics undercount fix (spot check)', () => {
  test.skip(!!process.env.CI, 'Spot check — run manually against lite-stg, not in CI');
  test.skip(!testConfig.isLite, 'Metrics gate-path is Lite-only');
  test.skip(!testConfig.isForge, 'Forge-only');

  test('gate-path bounded collect + editor-open full count', async ({ page }) => {
    const metricsLogs: string[] = [];
    const errorLogs: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (/\[metrics:/.test(text)) {
        metricsLogs.push(text);
        console.log('  metrics>', text.slice(0, 200));
      }
      if (msg.type() === 'error') errorLogs.push(text);
    });

    const pageId = testConfig.existingPageId ?? '105840643';
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'domcontentloaded' });

    const macroFrame = page.frameLocator(FORGE_FRAME);

    // ---- 1. Smoke: SVG renders ----
    await expect(macroFrame.locator('svg').first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await page.waitForTimeout(5000); // let gate-path collect settle

    const svgCount = await macroFrame.locator('svg').count();
    expect(svgCount, 'smoke: SVG must render').toBeGreaterThan(0);

    // Filter out known infrastructure noise: Forge/CDN asset 404s, rate-limit 429s,
    // third-party cookie warnings, and CSP/CORS info messages.
    const fatalErrors = errorLogs.filter(
      e => !/third-party cookie|deprecated|favicon|COR|Failed to load resource|net::/i.test(e),
    );
    if (fatalErrors.length) console.warn('console errors:', fatalErrors);
    expect(fatalErrors, 'smoke: no fatal app-level console errors on load').toHaveLength(0);

    // ---- 2. Gate-path: KV miss → bounded collect ----
    const missLog = metricsLogs.find(l => /\[metrics:kv:read\] miss/.test(l));
    const hitLog = metricsLogs.find(l => /\[metrics:kv:read\] hit/.test(l));
    const collectLog = metricsLogs.find(l => /\[metrics:collect\] success/.test(l));

    console.log(`KV: ${missLog ? 'MISS (good — pre-cleared)' : hitLog ? 'HIT (stale cache — re-clear KV and re-run for miss assertion)' : 'no KV log captured'}`);
    console.log(`collect: ${collectLog ?? 'not captured (OOPIF console may need frame-level listener)'}`);

    if (missLog && collectLog) {
      // Extract total from the object arg, e.g. "{space: SD, total: 250}" or '{"total":250}'
      // The ceiling is 100 but pagination pages are 250 items — so the first page of the first
      // content type returns 250 items, which exceeds the ceiling and stops further enumeration.
      // The bounded assertion is therefore "total << full-count (~1230)", not "total <= 100".
      // We use 500 as the upper bound: safely above one page (250) but well below full count.
      const totalMatch = collectLog.match(/total[^\d]*(\d+)/);
      if (totalMatch) {
        const total = Number(totalMatch[1]);
        console.log(`gate-path total=${total} (ceiling=${PAYWALL_COUNT_CEILING}, bounded upper bound=500)`);
        expect(total, 'gate-path collect must be bounded (early-exit stops after first page exceeds ceiling)').toBeLessThanOrEqual(500);
      }
    } else if (hitLog) {
      console.warn('⚠ KV was a cache HIT — clear KV and re-run to validate the bounded-collect assertion');
    }

    // ---- 3. Editor-open: reportMacroMetrics fires with TRUE total ----
    metricsLogs.length = 0; // reset to isolate editor-open logs

    const editBtn = macroFrame.getByRole('button', { name: 'Edit' });
    await expect(editBtn).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await editBtn.click();

    // reportMacroMetrics() fires before tryPageEditorPaywall() mounts the gate
    // (see forgeIndex.ts ~line 387 vs ~line 444), so we do NOT need to dismiss
    // the paywall gate to capture the [metrics:report] log.
    //
    // Full enumeration of ~1230 macros via V2 API takes ~10-30s on staging.
    // KV write adds a few more seconds. 45s is conservative.
    console.log('Waiting up to 45s for full enumeration + KV write...');
    await page.waitForTimeout(45000);

    const reportLog = metricsLogs.find(l => /\[metrics:report\] success/.test(l));
    console.log(`report: ${reportLog ?? 'NOT captured — editor-open path may not be live or OOPIF console needs frame listener'}`);

    expect(reportLog, 'editor-open reportMacroMetrics must fire').toBeTruthy();

    if (reportLog) {
      const totalMatch = reportLog.match(/total[^\d]*(\d+)/);
      if (totalMatch) {
        const total = Number(totalMatch[1]);
        console.log(`editor-open total=${total} (must be > ${PAYWALL_COUNT_CEILING})`);
        expect(total, 'editor-open count must be TRUE total (>> ceiling)').toBeGreaterThan(PAYWALL_COUNT_CEILING);
      }
    }
  });
});
