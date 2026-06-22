import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { getPageId } from '../../utils/page-registry.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { dismissPaywallGate } from '../../helpers/paywallGate.js';

/**
 * End-to-end proof of Lever D (mermaid) on lite-stg: re-save the mermaid macro so
 * the save path (maybeAttachMermaidSvg) renders + stores `mermaidSvg` in the CC
 * body, then re-view it and assert the macro_viewed payload reports
 * render_mode=cached_svg with NO resource_load_ms (the mermaid vendor bundle is
 * skipped). This is the on-lite-stg confirmation of what the component test and the
 * cold-path resource_load measurement already imply.
 *
 *   APP=zenuml-lite@stg npx playwright test --project=benchmark --grep "Lever D"
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

test.describe('Lever D mermaid cached_svg (lite-stg)', () => {
  test.describe.configure({ mode: 'serial', timeout: 0 });

  test('re-save populates mermaidSvg → next view is cached_svg, no bundle load', async ({ page, context }) => {
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
    const pageId = getPageId('mermaid');
    const frame = macroPage.getSequenceMacroFrame(); // Forge uses one container selector for all macros

    // 1) Re-save: edit the macro, clear the over-limit paywall gate, publish.
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
    await expect(page.locator('#title-text')).toBeVisible();
    await macroPage.dismissSpotlightModal();
    await macroPage.editMacro(frame);
    await dismissPaywallGate(page, macroPage.getEditorDialogFrame());
    await macroPage.saveInEditor();
    // Editor modal closes on a successful publish.
    await expect(page.getByTestId('custom-ui-fullscreen-modal-dialog')).toBeHidden({ timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    // 2) Re-view: the stored mermaidSvg should now drive a cached_svg render.
    captured.length = 0;
    await page.goto(testConfig.pageUrl(pageId), { waitUntil: 'load' });
    await macroPage.dismissSpotlightModal();
    await expect
      .poll(() => captured.some((p) => p.macro_type === 'mermaid'), { timeout: 60_000 })
      .toBeTruthy();

    const p = [...captured].reverse().find((pp) => pp.macro_type === 'mermaid')!;
    // eslint-disable-next-line no-console
    console.log(
      '[lever-d] mermaid after re-save:',
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
    // The whole point: the mermaid vendor bundle is NOT loaded on a cache hit.
    expect(p.resource_load_ms, 'no renderer-bundle load on cache hit').toBeUndefined();
  });
});
