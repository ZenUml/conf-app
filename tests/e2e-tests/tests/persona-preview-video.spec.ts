/**
 * Persona Paywall — Video walkthrough of each variant.
 *
 * Records one webm per variant, with light interaction so the video isn't a static frame.
 *
 * Run with `pnpm start:local` already running on :8080:
 *   npx playwright test tests/persona-preview-video.spec.ts --project=preview
 *
 * Output: tests/e2e-tests/test-results/.../video.webm
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:8080/persona-preview.html'

// Force video recording even if project default is 'retain-on-failure'.
test.use({ video: 'on', viewport: { width: 1024, height: 768 } })

const VARIANTS = [
  { name: 'bystander', label: 'BystanderNotice' },
  { name: 'comparison', label: 'ComparisonView' },
  { name: 'heavy-admin-medium', label: 'HeavyCreator (admin + medium → Bundle primary)' },
  { name: 'heavy-non-admin', label: 'HeavyCreator (non-admin → Bundle primary)' },
  { name: 'heavy-admin-small', label: 'HeavyCreator (admin + small → Marketplace primary)' },
] as const

test.describe('Persona Paywall Video Walkthrough', () => {
  for (const variant of VARIANTS) {
    test(`${variant.label}`, async ({ page }) => {
      await page.goto(`${BASE}?variant=${variant.name}`)
      // Wait for modal
      await expect(page.locator('div.fixed.inset-0').first()).toBeVisible({ timeout: 10_000 })
      // Initial pause so the modal is on-screen for a moment
      await page.waitForTimeout(1500)

      // Light hover interactions so video has motion
      const buttons = page.getByRole('button')
      const count = await buttons.count()
      for (let i = 0; i < Math.min(count, 4); i++) {
        const b = buttons.nth(i)
        if (await b.isVisible().catch(() => false)) {
          await b.hover().catch(() => {})
          await page.waitForTimeout(400)
        }
      }
      // Final pause
      await page.waitForTimeout(1000)
    })
  }
})
