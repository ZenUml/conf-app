import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { getPageId } from '../../utils/page-registry.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { dismissPaywallGate } from '../../helpers/paywallGate.js';

/**
 * End-to-end proof of Lever D (sequence) on lite-stg: re-save the ZenUML sequence
 * macro so the save path (maybeAttachSequenceSvg → renderSequenceToSvg) stores
 * `sequenceSvg` in the CC body, then re-view it and assert the macro_viewed payload
 * reports render_mode=cached_svg with NO resource_load_ms — i.e. the ~2.1s
 * @zenuml/core bundle is NOT loaded on the cache hit. This is the win the at-view
 * sync_svg path could not deliver (sync_svg still loads the bundle to call
 * renderToSvg in the browser; Lever D moves that render to save time).
 *
 * Unlike the graph variant, sequence's editor is a plain text editor — NOT the
 * DrawIO editor whose publish automation is flaky on the over-limit SD space — so
 * the standard editMacro/saveInEditor re-save flow drives this end to end.
 *
 *   APP=zenuml-lite@stg npx playwright test --project=benchmark --grep "Lever D sequence"
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

test.describe('Lever D sequence cached_svg (lite-stg)', () => {
  test.describe.configure({ mode: 'serial', timeout: 0 });

  test('re-save populates sequenceSvg → next view is cached_svg, no bundle load', async ({ page, context }) => {
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
    const pageId = getPageId('sequence');
    const frame = macroPage.getSequenceMacroFrame();

    // 1) Re-save: edit the macro, clear the over-limit paywall gate, publish.
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
    await expect(page.locator('#title-text')).toBeVisible();
    await macroPage.dismissSpotlightModal();
    await macroPage.editMacro(frame);
    await dismissPaywallGate(page, macroPage.getEditorDialogFrame());
    await macroPage.saveInEditor();
    await expect(page.getByTestId('custom-ui-fullscreen-modal-dialog')).toBeHidden({ timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    // 2) Re-view: the stored sequenceSvg should now drive a cached_svg render.
    captured.length = 0;
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
    await macroPage.dismissSpotlightModal();
    await expect
      .poll(() => captured.some((p) => p.macro_type === 'sequence'), { timeout: 60_000 })
      .toBeTruthy();

    const p = [...captured].reverse().find((pp) => pp.macro_type === 'sequence')!;
    // eslint-disable-next-line no-console
    console.log(
      '[lever-d] sequence after re-save:',
      JSON.stringify({
        render_mode: p.render_mode,
        cache_source: p.cache_source,
        render_ms: p.render_ms,
        resource_load_ms: p.resource_load_ms,
        duration_ms: p.duration_ms,
        app_commit: p.app_commit,
      }),
    );

    expect(p.render_mode, 'render served from the stored SVG cache').toBe('cached_svg');
    expect(p.cache_source).toBe('cc_body');
    // The whole point: the @zenuml/core bundle is NOT loaded on a cache hit.
    expect(p.resource_load_ms, 'no renderer-bundle load on cache hit').toBeUndefined();
  });
});
