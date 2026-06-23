import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { getPageId } from '../../utils/page-registry.js';
import { MacroPage } from '../../pages/MacroPage.js';

/**
 * Acceptance for Lever D (graph) on lite-stg: re-save the graph macro (DrawIO
 * editor publish → saveToPlatform → maybeAttachGraphSvg renders + stores graphSvg),
 * then re-view and assert the macro_viewed payload reports render_mode=cached_svg
 * with NO resource_load_ms — the dispositive signal that the ~3.8MB DrawIO viewer
 * load was skipped (per the blueprint: "treat resource_load_ms absent on cache hit
 * as the go/no-go acceptance, not GraphViewer-constructor-not-called").
 *
 *   APP=zenuml-lite@stg npx playwright test --project=benchmark --grep "Lever D graph"
 */

function decodeTrack(postData: string | null): Array<{ event?: string; properties?: Record<string, unknown> }> {
  if (!postData) return [];
  let data: string | null = null;
  try {
    data = new URLSearchParams(postData).get('data');
  } catch {
    /* not form-encoded */
  }
  if (!data) return [];
  for (const dec of [
    () => JSON.parse(decodeURIComponent(data!)),
    () => JSON.parse(data!),
    () => JSON.parse(Buffer.from(decodeURIComponent(data!), 'base64').toString('utf8')),
  ]) {
    try {
      const j = dec();
      return Array.isArray(j) ? j : [j as { event?: string }];
    } catch {
      /* next */
    }
  }
  return [];
}

test.describe('Lever D graph cached_svg (lite-stg)', () => {
  test.describe.configure({ mode: 'serial', timeout: 0 });

  test('re-save populates graphSvg → next view is cached_svg, no DrawIO load', async ({ page, context }) => {
    const captured: Record<string, unknown>[] = [];
    context.on('request', (req) => {
      const u = req.url();
      if (req.method() === 'POST' && u.includes('mixpanel.com') && u.includes('/track')) {
        for (const e of decodeTrack(req.postData())) {
          if (e && e.event === 'macro_viewed' && e.properties) captured.push(e.properties);
        }
      }
    });

    const macroPage = new MacroPage(page);
    const pageId = getPageId('graph');
    const frame = macroPage.getGraphMacroFrame();

    // 1) Re-save through the DrawIO editor (adds a shape + publishes).
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
    await expect(page.locator('#title-text')).toBeVisible();
    await macroPage.dismissSpotlightModal();
    await macroPage.editGraphMacroFromViewer(frame);
    await page.waitForTimeout(2_000);

    // 2) Re-view: the stored graphSvg should now drive a cached_svg render.
    captured.length = 0;
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
    await macroPage.dismissSpotlightModal();
    await expect.poll(() => captured.some((p) => p.macro_type === 'graph'), { timeout: 60_000 }).toBeTruthy();

    const p = [...captured].reverse().find((pp) => pp.macro_type === 'graph')!;
    // eslint-disable-next-line no-console
    console.log(
      '[lever-d] graph after re-save:',
      JSON.stringify({
        render_mode: p.render_mode,
        cache_source: p.cache_source,
        render_ms: p.render_ms,
        resource_load_ms: p.resource_load_ms,
        duration_ms: p.duration_ms,
        app_commit: p.app_commit,
      }),
    );

    expect(p.render_mode, 'graph served from the stored SVG cache').toBe('cached_svg');
    expect(p.cache_source).toBe('cc_body');
    // The dispositive Lever D signal: the DrawIO viewer bundle is NOT loaded on a cache hit.
    expect(p.resource_load_ms, 'no DrawIO load on cache hit').toBeUndefined();
  });
});
