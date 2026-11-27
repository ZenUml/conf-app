import { Page, FrameLocator } from '@playwright/test';

/**
 * Dismiss the Lite over-limit paywall gate (UpgradePrompt) when it covers the
 * editor, returning true if a gate was handled.
 *
 * Why this is more than a one-shot `count() > 0` + click:
 *
 *  - The gate mounts a beat AFTER the editor frame. An instantaneous count()
 *    races it: count() sees nothing, we skip, then the gate appears and its
 *    full-screen `fixed inset-0 bg-black bg-opacity-75` backdrop intercepts all
 *    pointer events on the DrawIO canvas and the Publish button.
 *  - A single early `force` click can land BEFORE Vue wires the button's @click
 *    handler, so the click "succeeds" (no error) yet the overlay never closes.
 *
 * So: wait for the gate to actually appear (under-limit spaces never show it),
 * click Continue, then CONFIRM the button detached (the gate unmounted) and
 * retry if it is still up. Confirming detachment is deliberate — if the product
 * ever genuinely fails to dismiss on Continue, this stays red rather than
 * silently proceeding, instead of masking a real escape-hatch regression.
 */
export async function dismissPaywallGate(
  page: Page,
  frame: FrameLocator,
  { appearTimeout = 4000, attempts = 4 }: { appearTimeout?: number; attempts?: number } = {},
): Promise<boolean> {
  const continueBtn = frame.locator('[data-testid="continue-editing-btn"]');

  // Wait once for the gate to show. Under the macro limit it never will — that
  // is the expected no-op, not a failure.
  const appeared = await continueBtn
    .waitFor({ state: 'visible', timeout: appearTimeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;

  // Reset the metered continue counter before dismissing. The allowance is 3
  // per (domain, space, account) — a spec driving 4+ editor mounts in one
  // browser context would exhaust it mid-test, the Continue button would be
  // replaced by non-clickable "request an extension" copy, and the test would
  // flake on product policy rather than product behavior. Test-env insulation
  // only; the counter still decrements normally between resets.
  await frame
    .locator('body')
    .evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('paywallContinueAttempts:'))
        .forEach((k) => localStorage.removeItem(k));
    })
    .catch(() => {
      // best-effort: a cross-origin or storage failure must not fail the dismiss
    });

  for (let i = 0; i < attempts; i++) {
    if (!(await continueBtn.isVisible().catch(() => false))) return true; // gate gone
    console.log(`Paywall gate detected; clicking Continue editing (attempt ${i + 1}/${attempts})`);
    await continueBtn.click({ force: true });
    // On dismiss the gate unmounts and the button detaches; give Vue a moment.
    await continueBtn.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  return !(await continueBtn.isVisible().catch(() => false));
}
