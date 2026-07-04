/**
 * Helpers for the single Forge `confluence:pageBanner` host (`zenuml-page-banner`).
 *
 * Pure functions over Page / FrameLocator — no test-runner assertions beyond the
 * one visibility wait that callers rely on. The host renders ONE iframe per page
 * and decides which banner to show (paywall warning > CSAT). These helpers prime
 * the per-space paywall state and drill into the banner UI.
 *
 * Marker/mocks live in the app's Forge iframe localStorage — `cdn.prod.atlassian-dev.net`
 * on a deployed env, or `localhost:8000` under a Forge tunnel. All of the app's
 * iframes on the page share that origin, so the macro iframe (writer) and the
 * page-banner iframe (reader) see the same store.
 */
import { Page, FrameLocator, expect } from '@playwright/test';

/**
 * The Forge pageBanner host iframe has NO data-module-key; it's the
 * `hosted-resources-iframe` nested under `div[data-testid="forge-page-banner-wrapper"]`
 * (the macro iframe's wrapper is `ForgeExtensionContainer`). Confirmed via the
 * feat/page-banner-host spot-check on lite-dev. Second clause is a generic fallback.
 */
export const PAGE_BANNER_IFRAME =
  '[data-testid="forge-page-banner-wrapper"] iframe, [data-testid*="page-banner"] iframe';

/**
 * The app-under-test's macro iframe. Only that app inserts a macro on the test
 * page, so its iframe `src` carries the Forge app id we scope banner lookups to.
 */
export const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

/** First UUID path segment of a Forge iframe URL = the app id (env id follows). */
const APP_ID_RE =
  /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/**
 * Forge app id of the app under test, derived from its macro iframe by
 * `initPageBannerScope`. On multi-install sites (prod zenuml.atlassian.net runs
 * lite + full + diagramly) EVERY installed app mounts a `zenuml-page-banner`
 * host iframe, so an unscoped `PAGE_BANNER_IFRAME` matches 3 elements and trips
 * Playwright strict mode. Scoping to this id resolves to exactly the app under
 * test. Empty string ⇒ fall back to the unscoped selector (single-install envs).
 */
let scopedAppId = '';

/**
 * Read the app-under-test's Forge app id from its rendered macro iframe and scope
 * subsequent `pageBannerFrame` / `appFrame` lookups to it. Call once per page load
 * (from `beforeEach`), after the macro iframe is visible. Idempotent; a miss (no
 * macro iframe / unparsable src) clears the scope so callers fall back gracefully.
 */
export async function initPageBannerScope(page: Page): Promise<void> {
  const src = await page
    .locator(MACRO_IFRAME)
    .first()
    .getAttribute('src')
    .catch(() => null);
  const match = src ? APP_ID_RE.exec(src) : null;
  scopedAppId = match ? match[1] : '';
}

/** Banner-iframe selector, narrowed to the app under test when a scope is set. */
function bannerIframeSelector(): string {
  return scopedAppId
    ? `[data-testid="forge-page-banner-wrapper"] iframe[src*="${scopedAppId}"]`
    : PAGE_BANNER_IFRAME;
}

export function pageBannerFrame(page: Page): FrameLocator {
  return page.frameLocator(bannerIframeSelector());
}

/** Locate the app-under-test's Forge iframe (scoped to its app id when known). */
function appFrame(page: Page) {
  return page
    .frames()
    .find((f) =>
      scopedAppId
        ? f.url().includes(scopedAppId)
        : f.url().includes('cdn.prod.atlassian-dev.net') ||
          f.url().includes('localhost:8000'),
    );
}

export async function setAppMocks(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  const f = appFrame(page);
  if (!f) throw new Error('[page-banner] app Forge iframe not found — is a macro rendered?');
  await f.evaluate((kv) => {
    for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]);
  }, entries);
}

/** Remove only the paywall markers (targeting + activity + dismissal), leaving mocks in place. */
export async function clearPaywallMarkers(page: Page): Promise<void> {
  const f = appFrame(page);
  await f?.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => /^paywall(Warning|Activity|Banner):/.test(k))
      .forEach((k) => localStorage.removeItem(k));
  });
}

/** Reset all banner-related state (markers, mocks, CSAT trigger/suppression). */
export async function clearAllBannerState(page: Page): Promise<void> {
  const f = appFrame(page);
  await f?.evaluate(() => {
    Object.keys(localStorage)
      .filter(
        (k) =>
          /^paywall(Warning|Activity|Banner):/.test(k) ||
          k.startsWith('csatPending') ||
          k.startsWith('csat_state') ||
          ['mockMacroCount', 'mockSpacePaid', 'mockCSSEnabled'].includes(k),
      )
      .forEach((k) => localStorage.removeItem(k));
  });
}

/** Read the first localStorage value whose key starts with `prefix`, from the app frame. */
export async function readAppMarker(page: Page, prefix: string): Promise<string | null> {
  const f = appFrame(page);
  if (!f) return null;
  return f.evaluate((p) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith(p));
    return key ? localStorage.getItem(key) : null;
  }, prefix);
}

/** True when no page-banner iframe is visible (host called view.close()). */
export async function expectBannerAbsent(page: Page): Promise<void> {
  await expect(page.locator(bannerIframeSelector())).toBeHidden({ timeout: 10_000 });
}

/** True when the host iframe is NOT showing the CSAT survey (its rating bar). */
export async function expectCsatAbsent(page: Page): Promise<void> {
  await expect(pageBannerFrame(page).locator('.pb-bar')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Arm a fresh CSAT trigger in the tenant-scoped key (`csatPending-<domain>`) and
 * clear CSAT self-suppression, so CSAT *would* show absent a higher-priority
 * banner. The domain is the Confluence subdomain (same value getClientDomain()
 * derives), read from the page host.
 */
export async function armCsatPending(page: Page): Promise<void> {
  const domain = new URL(page.url()).hostname.split('.')[0];
  await setAppMocks(page, { [`csatPending-${domain}`]: String(Date.now()) });
  const f = appFrame(page);
  await f?.evaluate((d) => {
    localStorage.removeItem(`csat_state-${d}`);
  }, domain);
}

/**
 * Drive the space over the hard Lite limit and wait for the paywall banner.
 * `mockMacroCount=101` makes the macro write a critical targeting marker on its
 * render. The recent activity marker is written directly because this test reuses
 * an existing page instead of creating or editing a macro in each scenario.
 * The first reload writes the marker; the second lets the page-banner read it.
 * Resolves once the banner is shown.
 */
export async function showWarningBanner(page: Page): Promise<void> {
  await setAppMocks(page, {
    mockMacroCount: '101',
    mockSpacePaid: 'false',
    mockCSSEnabled: 'true',
    zenumlDebug: 'true',
  });
  await clearPaywallMarkers(page);
  await page.reload();
  await page.waitForTimeout(6_000); // macro renders + writes the warning marker
  const domain = new URL(page.url()).hostname.split('.')[0];
  const now = Date.now();
  // Must match the production MacroActivityMarker shape (warningBanner.ts):
  // parseMacroActivityMarker requires a string `lastActivityAt` — anything else
  // parses to null and the visibility gate fails closed (banner never mounts).
  await setAppMocks(page, {
    [`paywallActivity:${domain}:SD`]: JSON.stringify({
      lastActivityAt: new Date(now).toISOString(),
      activityType: 'edit',
    }),
  });
  await page.reload();
  await page.waitForTimeout(6_000); // page-banner reads the marker and mounts
  await expect(
    pageBannerFrame(page).getByTestId('paywall-warning-banner'),
  ).toBeVisible({ timeout: 20_000 });
}
