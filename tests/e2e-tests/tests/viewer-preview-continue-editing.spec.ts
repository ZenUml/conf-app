/**
 * Continue editing button — SPA test against the local Vite dev server.
 *
 * Mounts the real GenericViewer with paywall-blocking localStorage mocks and
 * exercises the click flow that fires `EventBus.$emit('edit')`. No Confluence
 * or Forge auth required — runs entirely against `pnpm start:local`.
 *
 * Run:
 *   pnpm start:local &
 *   npx playwright test tests/viewer-preview-continue-editing.spec.ts --project=preview
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:8080/viewer-preview.html'

test.describe('GenericViewer — Continue editing button', () => {
  test.use({ viewport: { width: 1100, height: 720 } })

  test('Edit click → Continue editing closes modal and fires edit', async ({ page }) => {
    await page.goto(BASE)

    const editButton = page.getByRole('button', { name: 'Edit' })
    await expect(editButton).toBeVisible({ timeout: 10_000 })

    // Sanity: the SPA harness installed the EventBus counter.
    expect(await page.evaluate(() => (window as any).__editFiredCount)).toBe(0)

    await editButton.click()

    const continueBtn = page.locator('[data-testid="continue-editing-btn"]')
    await expect(continueBtn).toBeVisible({ timeout: 5_000 })

    await continueBtn.click()

    await expect(continueBtn).toBeHidden()
    expect(await page.evaluate(() => (window as any).__editFiredCount)).toBe(1)
  })

  test('Upgrade-badge click → Continue editing closes modal but does NOT fire edit', async ({ page }) => {
    await page.goto(BASE)

    const upgradeBadge = page.locator('button[title="Upgrade to unlock unlimited diagrams"]')
    await expect(upgradeBadge).toBeVisible({ timeout: 10_000 })

    expect(await page.evaluate(() => (window as any).__editFiredCount)).toBe(0)

    await upgradeBadge.click()

    const continueBtn = page.locator('[data-testid="continue-editing-btn"]')
    await expect(continueBtn).toBeVisible({ timeout: 5_000 })

    await continueBtn.click()

    await expect(continueBtn).toBeHidden()
    expect(await page.evaluate(() => (window as any).__editFiredCount)).toBe(0)
  })
})
