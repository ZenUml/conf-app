/**
 * Persona Paywall — Visual snapshot tests against local Vite dev server.
 *
 * Run with the dev server already running on :8080 (`pnpm start:local`):
 *   npx playwright test tests/persona-preview.spec.ts --project=insert
 *
 * To update baselines:
 *   npx playwright test tests/persona-preview.spec.ts --project=insert --update-snapshots
 */

import { test, expect } from '@playwright/test'

const BASE = 'http://127.0.0.1:8080/persona-preview.html'

const VARIANTS = [
  { name: 'bystander', label: 'BystanderNotice' },
  { name: 'comparison', label: 'ComparisonView' },
  { name: 'heavy-admin-medium', label: 'HeavyCreator (admin + medium → Bundle primary)' },
  { name: 'heavy-non-admin', label: 'HeavyCreator (non-admin → Bundle primary)' },
  { name: 'heavy-admin-small', label: 'HeavyCreator (admin + small → Marketplace primary)' },
] as const

test.describe('Persona Paywall Visual Snapshots', () => {
  test.use({ viewport: { width: 900, height: 720 } })

  for (const variant of VARIANTS) {
    test(`${variant.label} matches snapshot`, async ({ page }) => {
      await page.goto(`${BASE}?variant=${variant.name}`)
      // Wait for Teleport target to render
      await expect(page.locator('div.fixed.inset-0').first()).toBeVisible({ timeout: 10_000 })
      // Disable animations / caret blink for stable diffs
      await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }' })
      await expect(page).toHaveScreenshot(`${variant.name}.png`, {
        maxDiffPixelRatio: 0.01,
        fullPage: false,
      })
    })
  }
})
