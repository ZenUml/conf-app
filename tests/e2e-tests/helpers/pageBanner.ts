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
import { Page, FrameLocator, Frame, expect } from '@playwright/test';
import { testConfig } from '../config/test-config.js';

/**
 * The Forge pageBanner host iframe has NO data-module-key; it's the
 * `hosted-resources-iframe` nested under `div[data-testid="forge-page-banner-wrapper"]`
 * (the macro iframe's wrapper is `ForgeExtensionContainer`). Confirmed via the
 * feat/page-banner-host spot-check on lite-dev. Second clause is a generic fallback.
 */
export const PAGE_BANNER_IFRAME =
  '[data-testid="forge-page-banner-wrapper"] iframe, [data-testid*="page-banner"] iframe';

/**
 * The rendered macro iframe for the variant under test. Its `src` origin
 * identifies which Forge app this test targets — used to scope both mock
 * injection and banner selection on multi-app sites (see `appHost`).
 */
const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

/**
 * Origin host of the variant-under-test's Forge iframes, read from the rendered
 * macro iframe's `src`.
 *
 * On a multi-app site — production `zenuml.atlassian.net` has lite, full AND
 * diagramly installed — every installed variant mounts its own
 * `confluence:pageBanner` host, so the bare wrapper selector resolves to one
 * iframe per variant (3 on prod) and trips Playwright's strict-mode check.
 *
 * Each Forge app serves its Custom UI from its own
 * `<hash>.cdn.prod.atlassian-dev.net` origin (the hash rotates per deployed app,
 * so lite/full/diagramly differ; all modules of one app share it — see
 * `src/utils/draftStore.ts`). The macro on this page is the variant under test's
 * own macro, so its origin isolates this app's page-banner (reader) and shares
 * its localStorage with this app's macro iframe (writer). Returns '' when no
 * macro iframe is present, in which case callers fall back to the unscoped
 * (single-app) behaviour.
 */
async function appHost(page: Page): Promise<string> {
  const src = await page.locator(MACRO_IFRAME).first().getAttribute('src').catch(() => null);
  if (!src) return '';
  try {
    return new URL(src).host;
  } catch {
    return '';
  }
}

/** Page-banner iframe selector scoped to this variant's origin (no-op on single-app sites). */
async function scopedBannerSelector(page: Page): Promise<string> {
  const host = await appHost(page);
  // A DNS host is only [a-z0-9.-]; sanitize defensively so it's always a safe
  // attribute-substring literal (CSS.escape is a browser API, unavailable here).
  const h = host.replace(/[^a-zA-Z0-9.-]/g, '');
  if (!h) return PAGE_BANNER_IFRAME;
  return `[data-testid="forge-page-banner-wrapper"] iframe[src*="${h}"], [data-testid*="page-banner"] iframe[src*="${h}"]`;
}

export async function pageBannerFrame(page: Page): Promise<FrameLocator> {
  return page.frameLocator(await scopedBannerSelector(page));
}

/**
 * Locate this variant's Forge iframe (deployed CDN origin or tunnel localhost).
 * Scoped to the macro iframe's host so mocks/markers land in the app under test's
 * localStorage — critical on multi-app prod where an unscoped match could write to
 * a co-installed variant's origin, leaving this variant's banner un-triggered.
 */
export async function appFrame(page: Page): Promise<Frame | undefined> {
  const host = await appHost(page);
  const frames = page.frames();
  if (host) {
    const scoped = frames.find((f) => f.url().includes(host));
    if (scoped) return scoped;
  }
  return frames.find(
    (f) =>
      f.url().includes('cdn.prod.atlassian-dev.net') ||
      f.url().includes('localhost:8000'),
  );
}

export async function setAppMocks(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  const f = await appFrame(page);
  if (!f) throw new Error('[page-banner] app Forge iframe not found — is a macro rendered?');
  await f.evaluate((kv) => {
    for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]);
  }, entries);
}

/** Remove only the paywall markers (targeting + activity + dismissal), leaving mocks in place. */
export async function clearPaywallMarkers(page: Page): Promise<void> {
  const f = await appFrame(page);
  await f?.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => /^paywall(Warning|Activity|Banner):/.test(k))
      .forEach((k) => localStorage.removeItem(k));
  });
}

/** Reset all banner-related state (markers, mocks, CSAT trigger/suppression). */
export async function clearAllBannerState(page: Page): Promise<void> {
  const f = await appFrame(page);
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
  const f = await appFrame(page);
  if (!f) return null;
  return f.evaluate((p) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith(p));
    return key ? localStorage.getItem(key) : null;
  }, prefix);
}

/** True when this variant's page-banner iframe is not visible (host called view.close()). */
export async function expectBannerAbsent(page: Page): Promise<void> {
  await expect(page.locator(await scopedBannerSelector(page))).toBeHidden({ timeout: 10_000 });
}

/** True when the host iframe is NOT showing the CSAT survey (its rating bar). */
export async function expectCsatAbsent(page: Page): Promise<void> {
  await expect((await pageBannerFrame(page)).locator('.pb-bar')).toHaveCount(0, { timeout: 10_000 });
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
  const f = await appFrame(page);
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
  // Space key MUST match the page the fixture macro lives in. Hardcoding 'SD'
  // matched only staging (space SD); on prod the smoke runs in space ZEN, so the
  // activity marker key (paywallActivity:<domain>:<space>) missed and the banner
  // never mounted — the recurring prod-smoke shard-3 timeout. Use the env-driven
  // space key (ZENUML_SPACE) like the rest of the suite.
  await setAppMocks(page, {
    [`paywallActivity:${domain}:${testConfig.spaceKey}`]: JSON.stringify({
      lastActivityAt: new Date(now).toISOString(),
      activityType: 'edit',
    }),
  });
  await page.reload();
  await page.waitForTimeout(6_000); // page-banner reads the marker and mounts
  await expect(
    (await pageBannerFrame(page)).getByTestId('paywall-warning-banner'),
  ).toBeVisible({ timeout: 20_000 });
}
