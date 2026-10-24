import { Page, Locator, expect } from '@playwright/test';

/**
 * Fail-fast guard for the Atlassian login redirect.
 *
 * The smoke/insert specs reuse a single `storageState` (auth dedup, see
 * e2e-test.yml). When that session is invalid/expired for a given navigation —
 * which happens intermittently on PROD — Confluence bounces the page to
 * `id.atlassian.com/login`. The content then never loads, so a downstream
 * `expect(locator).toBeVisible({ timeout: FRAME_LOAD })` (60s) waits the full
 * timeout and, under retries, burns ~3 min per test. On the prod smoke that
 * wedged shard 3 past its job-timeout cap and the run was cancelled before
 * Playwright could upload a trace — a silent, unattributable failure.
 *
 * These helpers detect the login screen and fail in ~1s with a clear message,
 * so the redirect surfaces as a fast, NAMED failure (with screenshot/trace)
 * instead of a hang. They do NOT mask failures — a genuinely missing macro
 * still fails via the normal assertion path below.
 */

/** URLs Confluence redirects to when the reused session can't authenticate. */
const ATLASSIAN_LOGIN_RE = /(id|auth)\.atlassian\.com|\/login(\b|\?|$)/i;

/** True when the page is currently sitting on an Atlassian login/auth screen. */
export function isOnAtlassianLogin(page: Page): boolean {
  return ATLASSIAN_LOGIN_RE.test(page.url());
}

function loginRedirectError(page: Page): Error {
  return new Error(
    `Auth lost: the page is on the Atlassian login screen (${page.url()}). ` +
      `The reused storageState session is invalid/expired for this navigation, so the ` +
      `Confluence content never loads. Failing fast instead of waiting out the load timeout ` +
      `(this is the prod-smoke wedge that previously ate the whole shard with no trace — ` +
      `see .github/workflows/e2e-test.yml shard timeout note).`,
  );
}

/** Throw immediately if the page has already landed on the login screen. */
export function assertNotOnAtlassianLogin(page: Page): void {
  if (isOnAtlassianLogin(page)) throw loginRedirectError(page);
}

/**
 * Wait for `locator` to become visible, but bail FAST (≤ ~`pollMs`) if the page
 * is, or becomes, redirected to the Atlassian login screen — rather than hanging
 * the full `timeout` (× retries) on a locator that can never appear on a login page.
 *
 * Pass a single-element locator (use `.first()`); `isVisible()` is strict-mode safe
 * only on a single match.
 */
export async function expectVisibleOrFailOnLogin(
  page: Page,
  locator: Locator,
  timeout: number,
  pollMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (true) {
    if (isOnAtlassianLogin(page)) throw loginRedirectError(page);
    if (await locator.isVisible().catch(() => false)) return;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(pollMs);
  }
  // Not a login redirect, but the locator still isn't visible within `timeout`.
  // Emit a normal Playwright assertion failure so the usual screenshot/trace and
  // a precise matcher diff are attached, instead of a bare throw.
  assertNotOnAtlassianLogin(page);
  await expect(locator).toBeVisible({ timeout: 1000 });
}
