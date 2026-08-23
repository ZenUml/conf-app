/**
 * Continue editing button — SPA test against the local Vite dev server.
 *
 * Drives the real `tryPageEditorPaywall` gate (src/utils/paywall/mountPaywallGate.ts)
 * through the editor-preview.html harness — the editor-modal counterpart to
 * viewer-preview.html. No Confluence or Forge auth required; runs entirely
 * against `pnpm start:local`.
 *
 * History: this spec originally drove GenericViewer.vue directly (it used to
 * own `openUpgradeModal` / `UpgradePromptRouter`) via viewer-preview.html,
 * asserting an Edit-button click opened the modal and a Continue-editing
 * click fired `EventBus.$emit('edit')`. Both of those were removed — the
 * paywall now boots in a separate editor-modal iframe (forgeIndex.ts calling
 * tryPageEditorPaywall) that viewer-preview.html cannot reach, and there is
 * no more in-place "unlock editing in this same viewer" transition for
 * Continue editing to fire. Rewritten 2026-08-17 against editor-preview.html
 * to drive that gate directly. See PR history for the prior version.
 *
 * Coverage, before vs after (same two behaviours, adapted to where the UI
 * now lives):
 *   BEFORE: (1) clicking Edit opened the paywall modal, and clicking
 *     Continue editing closed it and fired the viewer's `edit` EventBus
 *     event; (2) clicking a separate "Upgrade to unlock" badge opened the
 *     same modal, and Continue editing closed it WITHOUT firing `edit`.
 *   AFTER: (1) a saturated-Lite-space editor boots straight into the
 *     blocked paywall gate, and clicking Continue editing closes the gate,
 *     reveals the underlying editor content, and consumes one of the
 *     persistent `paywallContinueAttempts` attempts (3 → 2); (2) exhausting
 *     all `DEFAULT_CONTINUE_ATTEMPTS` (3, lowered from 15 in PR #479)
 *     replaces the Continue editing button with the
 *     "Request extension to continue editing" exhausted state on the next
 *     gate mount. Both still prove the paywall gate appears and that
 *     Continue editing behaves — the second assertion is now sharper (a
 *     real persistent counter reaching zero) rather than a UI badge that no
 *     longer exists.
 *
 * Run:
 *   pnpm start:local &
 *   npx playwright test tests/viewer-preview-continue-editing.spec.ts --project=preview
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:8080/editor-preview.html'

test.describe('Editor-modal paywall gate — Continue editing', () => {
  test.use({ viewport: { width: 1100, height: 720 } })

  test('Blocked editor shows the paywall gate; Continue editing dismisses it, reveals the editor, and consumes one attempt', async ({ page }) => {
    await page.goto(BASE)

    // The "Continue editing" button's aria-label is the tooltip sentence
    // ("You have N temporary continue attempts left…"), which shares no
    // words with its visible label ("Continue editing without upgrading
    // (N)") — getByRole('button', { name }) never resolves against either
    // in full, so this uses the testid the app already ships.
    const continueBtn = page.locator('[data-testid="continue-editing-btn"]')
    await expect(continueBtn).toBeVisible({ timeout: 10_000 })
    await expect(continueBtn).toHaveText('Continue editing without upgrading (3)')

    const attemptsBefore = await readRemainingAttempts(page)
    expect(attemptsBefore).toBe(3)

    await continueBtn.click()

    await expect(continueBtn).toBeHidden()
    await expect(page.locator('[data-testid="editor-content-stub"]')).toBeVisible()

    const attemptsAfter = await readRemainingAttempts(page)
    expect(attemptsAfter).toBe(2)
  })

  test('Continue editing attempts exhaust after the default of 3, then the gate offers "Request extension" instead', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.goto(BASE)
      const continueBtn = page.locator('[data-testid="continue-editing-btn"]')
      await expect(continueBtn).toBeVisible({ timeout: 10_000 })
      await continueBtn.click()
    }

    expect(await readRemainingAttempts(page)).toBe(0)

    // Re-enter the (still saturated) editor a fourth time — same as clicking
    // Edit again after the space is still over the limit.
    await page.goto(BASE)

    await expect(page.locator('[data-testid="continue-editing-btn"]')).toHaveCount(0)
    const exhausted = page.locator('[data-testid="continue-attempts-exhausted"]')
    await expect(exhausted).toBeVisible({ timeout: 10_000 })
    await expect(exhausted).toHaveText('Request extension to continue editing')
  })
})

async function readRemainingAttempts(page: import('@playwright/test').Page): Promise<number | null> {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('paywallContinueAttempts')) {
        return JSON.parse(localStorage.getItem(key) || '{}').remainingAttempts ?? null
      }
    }
    return null
  })
}
