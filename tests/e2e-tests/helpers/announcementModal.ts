import { Page } from '@playwright/test';

/**
 * Atlassian periodically ships full-screen announcement / onboarding modals
 * (e.g. the "Allow me to reintroduce myself." Rovo promo, seen on lite-stg
 * from 2026-08-06) on top of the Confluence host UI. They overlay the whole
 * page behind an Atlaskit `Blanket` and swallow pointer events for whatever
 * the test was about to click. Playwright's own log shows the tell: the
 * target resolves as "visible, enabled and stable", the click is attempted,
 * and then times out because a `role="presentation"` div from
 * `.atlaskit-portal-container` intercepts pointer events — an unrelated
 * overlay stealing clicks, not a missing/broken element. Failure signatures:
 * `locator.click` 60s timeout on `[data-testid="app-navigation-create"]`
 * (EditorPage.createChildPage) and on
 * `getByRole('textbox', { name: /Main content area|Page editing area/ })`.
 *
 * These modals use Atlaskit's `@atlaskit/modal-dialog` with NO custom
 * `testId` prop, so they render the library's bare default ids:
 * `data-testid="modal-dialog"` on the dialog section and
 * `data-testid="modal-dialog--close-button"` on its round "×" button.
 *
 * Confirmed via a live probe against lite-stg.atlassian.net (2026-08-06) that
 * this is safe to auto-dismiss globally: our OWN in-flow dialogs deliberately
 * namespace their testIds and never collide with the bare default —
 * the "Insert elements" browser renders `element-browser-modal-dialog`, and
 * the "Publish page" dialog isn't an Atlaskit ModalDialog at all (no
 * `modal-dialog*` testid appears anywhere in its DOM). So scoping to the bare
 * `modal-dialog--close-button` testid dismisses only these one-off
 * promo/announcement modals and never intercepts our own dialogs.
 *
 * page.addLocatorHandler is the right tool here (vs. a one-shot check like
 * `MacroPage.dismissSpotlightModal`, which targets a *different* dialog —
 * `[data-testid="spotlight--dialog-container"]` — and only helps if called
 * at exactly the right moment): the announcement modal can appear on any
 * navigation, at any point mid-flow, so a single check at page-load time
 * isn't enough. The handler is invoked by Playwright automatically,
 * immediately before any action whose target it currently overlaps, for as
 * long as the page lives — and it is a no-op (zero added latency) on every
 * action while the modal never appears, which is the overwhelming majority
 * of runs.
 */
/**
 * Promo modals seen so far. The bare default covers modals shipped without a
 * custom testId. Others ship with their own testId and render no
 * `modal-dialog--close-button`, so they are listed by name:
 *
 * - `agentic-awareness-modal`: Rovo "Meet agents where you are" carousel
 *   (dia-stg, 2026-11-20). It blocked the viewer Edit click in edit-graph on
 *   all three tries. Buttons: "Close" (icon), "Dismiss", "Previous", "Next".
 *
 * Our own dialogs use namespaced testIds (e.g. `element-browser-modal-dialog`)
 * and never match. Covered by tests/unit/announcementModal.spec.ts.
 */
export const ANNOUNCEMENT_MODAL_TESTIDS = ['modal-dialog', 'agentic-awareness-modal'] as const;

export const ANNOUNCEMENT_MODAL_SELECTOR = ANNOUNCEMENT_MODAL_TESTIDS.map(
  (id) => `section[data-testid="${id}"]`,
).join(', ');

/**
 * Buttons tried in order. "Dismiss" first: it records the dismissal for the
 * account, so the modal does not return on the next navigation.
 */
export const ANNOUNCEMENT_DISMISS_BUTTON_TEXTS = ['Dismiss', 'Close'] as const;

const registered = new WeakSet<Page>();

export async function registerAnnouncementModalHandler(page: Page): Promise<void> {
  if (registered.has(page)) return;
  registered.add(page);

  const modal = page.locator(ANNOUNCEMENT_MODAL_SELECTOR).first();

  await page.addLocatorHandler(modal, async () => {
    const testId = await modal.getAttribute('data-testid').catch(() => null);
    console.log(`  [debug] Atlassian announcement modal detected (${testId}) — dismissing`);
    const bareClose = modal.locator('[data-testid="modal-dialog--close-button"]');
    if (await bareClose.isVisible().catch(() => false)) {
      if (await bareClose.click({ timeout: 5000 }).then(() => true, () => false)) return;
    }
    for (const text of ANNOUNCEMENT_DISMISS_BUTTON_TEXTS) {
      const button = modal.getByRole('button', { name: text, exact: true });
      if (await button.isVisible().catch(() => false)) {
        if (await button.click({ timeout: 5000 }).then(() => true, () => false)) return;
      }
    }
    // Escape is the documented a11y fallback for Atlaskit ModalDialog.
    await page.keyboard.press('Escape').catch(() => {});
  });
}
