/**
 * Editor-modal paywall gate — retired block, SPA test against the local Vite dev server.
 *
 * Drives the real `tryPageEditorPaywall` gate (src/utils/paywall/mountPaywallGate.ts)
 * through the editor-preview.html harness — the editor-modal counterpart to
 * viewer-preview.html. No Confluence or Forge auth required; runs entirely
 * against `pnpm start:local`.
 *
 * History: this spec originally asserted that a saturated-Lite-space editor
 * booted straight into a blocking `PaywallGate` modal, that "Continue
 * editing" consumed one of a persistent `paywallContinueAttempts` counter,
 * and that exhausting the counter replaced the button with a "Request
 * extension" dead end. Retired 2026-09: `shouldBlockActions` in
 * `useCustomerSuccessService` is now hardcoded `false` — the paywall no
 * longer blocks editing at any macro count, so `tryPageEditorPaywall` never
 * fires and the editor content mounts directly. `PaywallGate.vue` and
 * `continueAttempts.ts` are kept (unit-tested directly under tests/unit/)
 * in case a future gate reintroduces them, but this integration path no
 * longer exercises them.
 *
 * Run:
 *   pnpm start:local &
 *   npx playwright test tests/viewer-preview-continue-editing.spec.ts --project=preview
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:8080/editor-preview.html'

test.describe('Editor-modal paywall gate — retired block', () => {
  test.use({ viewport: { width: 1100, height: 720 } })

  test('Over-limit space still mounts the editor directly; no paywall gate appears', async ({ page }) => {
    // Default harness params set mockMacroCount=120 (over the 100 limit).
    await page.goto(BASE)

    await expect(page.locator('[data-testid="editor-content-stub"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="continue-editing-btn"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="continue-attempts-exhausted"]')).toHaveCount(0)
  })

  test('Under-limit space also mounts the editor directly (unchanged)', async ({ page }) => {
    await page.goto(`${BASE}?noBlock=1`)

    await expect(page.locator('[data-testid="editor-content-stub"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="continue-editing-btn"]')).toHaveCount(0)
  })
})
