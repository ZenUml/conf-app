/**
 * M1 first-seen ping — regression guard for the banner-host invokeRemote binding.
 *
 * Defect this catches (observed on lite-stg, 2026-08-09): `invokeRemote` from the
 * page-banner iframe fails with
 *   Entry point "resolver" for extension "zenuml-page-banner" could not be invoked
 * whenever manifest.yml's `confluence:pageBanner` entry lacks
 * `resolver: { endpoint: remote-connect }`. The client swallows the error by
 * design (never throw into the banner path), so WITHOUT this spec the only
 * symptom is silence: an `appFirstSeenAttempt:` stamp appears but the
 * `appFirstSeen:` marker never does, and no `app_first_seen` facts reach D1.
 *
 * Assertion strategy: a fresh Playwright context has no marker, so the ping is
 * due on the first page load. Success (or an explicit backend-disabled answer)
 * is the ONLY path that writes the `appFirstSeen:` marker — so "marker appears"
 * is equivalent to "the POST completed", with no network interception needed
 * (invokeRemote tunnels through the Forge bridge, not a directly-observable
 * HTTP request from the iframe).
 */
import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';

const BANNER_FRAME_URL = /atlassian-dev\.net|localhost:8000/;

test('first-seen ping completes from the banner host (marker written, no failure warn)', async ({ page }) => {
  test.setTimeout(120_000);

  const failures: string[] = [];
  page.on('console', (m) => {
    if (/\[first-seen\] ping failed/i.test(m.text())) failures.push(m.text().slice(0, 300));
  });

  await page.goto(testConfig.pageUrl(testConfig.parentPageId));

  // Poll the banner iframe's localStorage for the success marker. The banner
  // host resolves the Forge context, sends the awaited POST, then writes
  // `appFirstSeen:<domain>` — typically well under 30s on staging.
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          if (!BANNER_FRAME_URL.test(f.url())) continue;
          try {
            const keys = await f.evaluate(() => Object.keys(localStorage));
            if (keys.some((k) => k.startsWith('appFirstSeen:'))) return 'marker';
            if (keys.some((k) => k.startsWith('appFirstSeenAttempt:'))) return 'attempt-only';
          } catch {
            // OOPIF may detach mid-poll (view.close()); keep polling others.
          }
        }
        return 'none';
      },
      { timeout: 60_000, intervals: [2_000] }
    )
    .toBe('marker');

  expect(failures, `ping failed in-console: ${failures.join(' | ')}`).toHaveLength(0);
});
