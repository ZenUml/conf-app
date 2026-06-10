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
 * Status: local-first (preview project), like all viewer-preview-* specs.
 *
 *   # terminal 1, repo root:        pnpm start:local
 *   # terminal 2, tests/e2e-tests:  pnpm test:preview tests/viewer-preview-renderer-prefetch.spec.ts
 *
 * NOT covered here (needs a deployed bundle / live Confluence):
 * - prefetch-manifest.json chunk lists (build-only artifact)
 * - real CDN cache headers / cross-iframe warm flip (forge tunnel item — see
 *   docs/features/renderer-prefetch.md "Live verification")
 */
import { test, expect } from '@playwright/test'
import {
  seedFlagMemo,
  clearPrefetchState,
  runPrefetchInPage,
  probeUrls,
} from '../helpers/rendererPrefetch'

const BASE = 'http://127.0.0.1:8080/viewer-preview.html'

test.describe('renderer prefetch — browser mechanics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE)
    await clearPrefetchState(page)
  })

  test('flag on: injects DrawIO prefetch links that all resolve, warms mermaid, writes the done-key', async ({ page }) => {
    await seedFlagMemo(page, { macroHost: true, bannerHost: true })

    const result = await runPrefetchInPage(page, 'macro')

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
    await seedFlagMemo(page, { macroHost: true, bannerHost: true })

    await runPrefetchInPage(page, 'macro')
    await page.evaluate(() =>
      document.head.querySelectorAll('link[rel="prefetch"]').forEach((l) => l.remove()),
    )
    const second = await runPrefetchInPage(page, 'macro')
    expect(second.links).toHaveLength(0)
  })

  test('flag off: no links, no done-key (a later flag flip can still warm)', async ({ page }) => {
    await seedFlagMemo(page, { macroHost: false, bannerHost: false })

    const result = await runPrefetchInPage(page, 'banner')
    expect(result.links).toHaveLength(0)
    expect(result.doneKeySet).toBe(false)
  })

  test('banner host respects the banner sub-flag independently of master', async ({ page }) => {
    await seedFlagMemo(page, { macroHost: true, bannerHost: false })

    const banner = await runPrefetchInPage(page, 'banner')
    expect(banner.links).toHaveLength(0)
    expect(banner.doneKeySet).toBe(false)

    const macro = await runPrefetchInPage(page, 'macro')
    expect(macro.links.length).toBeGreaterThan(0)
  })
})
