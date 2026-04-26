/**
 * Persona-Aware Paywall — Production smoke test against zenuml.atlassian.net
 *
 * Verifies that enabling CUSTOMER_SUCCESS_SERVICE + PERSONA_AWARE_PAYWALL in production
 * KV causes the persona-aware paywall to render when Edit is clicked on a Lite macro.
 *
 * Only sets mockMacroCount (to guarantee the threshold is met) — all feature flags
 * are fetched from the real production portal KV.
 *
 * Run with:
 *   APP=zenuml-lite@prod npx playwright test tests/insert/persona-paywall-prod.spec.ts --headed --project=insert
 */

import { test, expect, type Page } from '@playwright/test'

const PROD_PAGE_URL = 'https://zenuml.atlassian.net/wiki/spaces/ZEN/pages/1806270487/PVT+Lite'
const FORGE_IFRAME = '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]'

async function waitForForgeIframe(page: Page) {
  const frame = page.frameLocator(FORGE_IFRAME).first()
  await expect(frame.locator('body')).toBeVisible({ timeout: 60_000 })
  return frame
}

test.describe('Persona-Aware Paywall — Production Verification', () => {
  test.skip(!!process.env.CI, 'Manual smoke only — not for CI')

  test('persona-aware paywall renders on Edit click (real feature flags)', async ({ context, page }) => {
    // Only mock the macro count to ensure shouldBlock threshold is met.
    // All other data (CUSTOMER_SUCCESS_SERVICE, PERSONA_AWARE_PAYWALL, space-status)
    // comes from the real production portal KV.
    await context.addInitScript(() => {
      localStorage.setItem('mockMacroCount', '120')
    })

    await page.goto(PROD_PAGE_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30_000 })

    const frame = await waitForForgeIframe(page)

    // Wait for the viewer to finish loading (Upgrade button visible = CSS flag active)
    await expect(frame.getByRole('button', { name: /upgrade/i }).first()).toBeVisible({ timeout: 30_000 })

    // Capture state before clicking Edit
    await page.screenshot({ path: 'persona-e2e-screenshots/prod-before-edit.png', fullPage: false })

    // Click Edit — this should trigger the persona-aware paywall
    await frame.getByRole('button', { name: /^edit$/i }).first().click()

    // One of the three persona variants should appear within the Forge iframe:
    //   HeavyCreatorPrompt:  "This space has reached the Lite limit"
    //   BystanderNotice:     "Editing paused on this space"
    //   ComparisonView:      "Marketplace" + "Enterprise Bundle" options
    const paywallVisible = await Promise.race([
      frame.getByText('This space has reached the Lite limit').waitFor({ timeout: 20_000 }).then(() => 'heavy-creator'),
      frame.getByText('Editing paused on this space').waitFor({ timeout: 20_000 }).then(() => 'bystander'),
      frame.getByText('Pick the upgrade that fits your team').waitFor({ timeout: 20_000 }).then(() => 'legacy'),
    ]).catch(() => 'none')

    await page.screenshot({ path: 'persona-e2e-screenshots/prod-paywall.png', fullPage: false })

    console.log(`✅ Paywall variant shown: ${paywallVisible}`)
    expect(paywallVisible).not.toBe('none')
    // Specifically assert the NEW persona-aware paywall (not the legacy one)
    expect(paywallVisible).not.toBe('legacy')
  })
})
