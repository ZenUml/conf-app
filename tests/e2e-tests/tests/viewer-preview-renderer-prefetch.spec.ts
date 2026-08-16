/**
 * Renderer prefetch (EAG-64) — browser-level verification of the idle
 * prefetch mechanism against the local Vite dev server.
 *
 * What this proves that jsdom cannot: real <link rel="prefetch"> elements
 * settle in Chromium, the DrawIO/Mermaid assets actually resolve on the
 * server (no 404s — i.e. the prefetch list matches reality), the Mermaid
 * import-warm pulls the real module, and the localStorage throttle makes a
 * second run a no-op.
 *
 * No feature-flag gating: `renderer-prefetch` / `renderer-prefetch-banner`
 * shipped to 100% on lite/diagramly in June 2026 and the kill switch was
 * retired in commit 2a0ccfce (2026-07-25) — `runRendererPrefetchIfDue` no
 * longer takes a `getFlags` option, it always runs subject to the runtime
 * guards (saveData, 2g, hidden tab, deviceMemory) only. This spec used to
 * carry two additional cases ("flag off: no links" / "no flag override:
 * fails closed") asserting the old fail-closed default; both were removed
 * here (2026-08-16) because they tested a code path deleted by 2a0ccfce —
 * the sibling unit spec (src/utils/prefetch/rendererPrefetch.spec.ts) was
 * updated in that same commit, but this E2E spec was not, because nothing
 * in CI ran it (see issue #374). `runPrefetchInPage`'s `flagOverride` param
 * is now a harmless no-op, kept only so the remaining "flag on" test name
 * still reads sensibly; do not add new fail-closed assertions here unless
 * flag gating actually returns.
 *
 * Status: local-first (preview project), like all viewer-preview-* specs.
 *
 *   # terminal 1, repo root:        pnpm start:local
 *   # terminal 2, tests/e2e-tests:  pnpm test:preview tests/viewer-preview-renderer-prefetch.spec.ts
 *
 * NOT covered here (needs a deployed bundle / live Confluence):
 * - prefetch-manifest.json chunk lists (build-only artifact)
 * - real Forge flag evaluation, CDN cache headers, cross-iframe warm flip
 *   (forge tunnel items — see docs/features/renderer-prefetch.md)
 */
import { test, expect } from '@playwright/test'
import { clearPrefetchState, runPrefetchInPage, probeUrls } from '../helpers/rendererPrefetch'

const BASE = 'http://127.0.0.1:8080/viewer-preview.html'

test.describe('renderer prefetch — browser mechanics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE)
    await clearPrefetchState(page)
  })

  test('flag on: injects DrawIO prefetch links that all resolve, warms mermaid, writes the done-key', async ({ page }) => {
    const result = await runPrefetchInPage(page, 'macro', true)

    // 4 DrawIO scripts + common.css (manifest chunks absent on the dev server).
    expect(result.links).toHaveLength(5)
    const hrefs = result.links.map((l) => l.href)
    expect(hrefs.some((h) => h.includes('drawio/js/viewer-static.min.js'))).toBe(true)
    expect(result.links.find((l) => l.href.includes('common.css'))?.as).toBe('style')

    // Every prefetched URL must actually exist — guards list/reality drift.
    const statuses = await probeUrls(page, hrefs)
    for (const status of statuses) expect(status).toBe(200)

    expect(result.mermaidWarmed).toBe(true)
    expect(result.doneKeySet).toBe(true)
  })

  test('second run is a no-op (deploy-keyed throttle)', async ({ page }) => {
    await runPrefetchInPage(page, 'macro', true)
    await page.evaluate(() =>
      document.head.querySelectorAll('link[rel="prefetch"]').forEach((l) => l.remove()),
    )
    const second = await runPrefetchInPage(page, 'macro', true)
    expect(second.links).toHaveLength(0)
  })

})
