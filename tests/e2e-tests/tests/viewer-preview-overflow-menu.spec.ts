/**
 * OverflowMenu — local regression check for More-trigger geometry + Download
 * debug info flow.
 *
 * Failure mode being guarded: the trigger button can render at 0×0 because of
 * Vue scoped-CSS hashing (a parent component's `.viewer-pill-btn` rule cannot
 * pierce a child component's data-v scope hash via `::v-slotted`). A unit
 * test that only inspects DOM presence cannot catch this — the button is in
 * the DOM but has zero clickable area. This spec asserts measured geometry,
 * opens the menu, and verifies the bundle download triggers.
 *
 * Status: **local-first**, matching the project convention for all
 * `viewer-preview-*.spec.ts` specs and the `feedback_local_verification`
 * project preference. This spec runs against the local Vite dev server and
 * is NOT gated by default CI workflows (`build-test-deploy`, `e2e-test*`).
 * Run it manually before pushing any change that touches OverflowMenu,
 * GenericViewer toolbar markup, or `.viewer-pill-btn` / `.viewer-icon`
 * scoped styling.
 *
 * Run (commands must be issued from the directories shown — the project
 * is defined in `tests/e2e-tests/playwright.config.ts`, not at repo root):
 *
 *   # terminal 1, from repo root:
 *   pnpm start:local
 *
 *   # terminal 2, from `tests/e2e-tests/`:
 *   pnpm test:preview tests/viewer-preview-overflow-menu.spec.ts
 *
 * Future hardening (out of scope for this spec): wire the preview project into
 * CI — either by adding a Playwright `webServer` to the preview config so all
 * preview specs self-bootstrap, or by adding a dedicated workflow that starts
 * Vite and runs `--project=preview`. Doing so would gate every preview spec,
 * not just this one.
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:8080/viewer-preview.html'

test.describe('GenericViewer — OverflowMenu trigger + Download debug info', () => {
  test.use({ viewport: { width: 1100, height: 720 } })

  test.beforeEach(async ({ page }) => {
    // Capture blob downloads before the page revokes the object URL. The bundle
    // is dispatched via URL.createObjectURL + a.click(), which Playwright's
    // download event does NOT cover for blob: URLs.
    await page.addInitScript(() => {
      ;(window as any).__capturedBlobs = []
      const origCreate = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (blob: Blob) => {
        const url = origCreate(blob)
        blob.text().then(text => {
          ;(window as any).__capturedBlobs.push({ size: blob.size, type: blob.type, text })
        })
        return url
      }
    })
  })

  test('More trigger is 30×30 and Download debug info produces a JSON bundle', async ({ page }) => {
    await page.goto(BASE)

    // Reveal the bottom-edge toolbar (hover-gated).
    await page.locator('.viewer-surface').hover()

    const more = page.getByRole('button', { name: 'More' })
    await expect(more).toBeVisible({ timeout: 10_000 })

    // Geometry assertion — the actual production failure mode.
    const box = await more.boundingBox()
    expect(box, 'More trigger must have a measurable bounding box').not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(24)
    expect(box!.height).toBeGreaterThanOrEqual(24)
    expect(box!.width).toBeLessThanOrEqual(48)
    expect(box!.height).toBeLessThanOrEqual(48)

    await more.click()

    const downloadItem = page.getByRole('menuitem', { name: 'Download debug info' })
    await expect(downloadItem).toBeVisible()
    await downloadItem.click()

    // Wait for the blob capture (createObjectURL → blob.text() is async).
    await expect.poll(
      async () => page.evaluate(() => (window as any).__capturedBlobs?.length ?? 0),
      { timeout: 5_000 },
    ).toBeGreaterThan(0)

    const captured = await page.evaluate(() => (window as any).__capturedBlobs[0])
    expect(captured.type).toBe('application/json')
    expect(captured.size).toBeGreaterThan(0)

    const parsed = JSON.parse(captured.text)
    expect(parsed.bundleVersion).toBe(1)
    expect(parsed.identity).toBeDefined()
    expect(parsed.saved).toBeDefined()
    expect(parsed.identity.appVersion).toMatchObject({
      gitBranch: expect.any(String),
      gitHash: expect.any(String),
    })
  })
})
