import { Page, FrameLocator } from '@playwright/test';

/**
 * Dismiss the onboarding starter-template gallery (TemplateGallery.vue) when
 * it covers the editor, returning true if it was handled.
 *
 * A new macro whose code is still blank/seed auto-opens this gallery on
 * mount (Header.vue, "auto_first_open"). Its `fixed inset-0 z-50` backdrop
 * intercepts pointer events on everything behind it, including the format
 * tab switcher — so any test that switches tabs (e.g. Sequence -> PlantUML)
 * right after inserting a fresh macro must close it first, the same way
 * dismissPaywallGate handles the Lite over-limit gate.
 */
export async function dismissStarterGalleryIfPresent(
  page: Page,
  frame: FrameLocator,
  { appearTimeout = 4000 }: { appearTimeout?: number } = {},
): Promise<boolean> {
  const closeBtn = frame.locator('[data-testid="template-gallery-close"]');

  const appeared = await closeBtn
    .waitFor({ state: 'visible', timeout: appearTimeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;

  await closeBtn.click();
  await closeBtn.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);

  return !(await closeBtn.isVisible().catch(() => false));
}
