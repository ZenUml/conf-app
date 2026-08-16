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
 * Assertion strategy: inspect the Forge bridge's GraphQL relay. Production
 * hosts Lite, Full, and Diagramly page banners together, so localStorage from
 * any Forge iframe cannot prove which app made (or completed) the request.
 * The relay request carries the source app's extension ID, and its response
 * carries the inner remote HTTP status.
 */
import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { isSuccessfulForgeRelay, isTargetFirstSeenRelay } from '../../helpers/forgeRelay.js';

const FORGE_APP_ID_BY_PRODUCT = {
  lite: '8ad26115-211f-4216-971b-0540f606303d',
  full: 'd9e4002b-120b-426b-834b-402a4a5adce7',
  diagramly: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
  asyncapi: '49017727-af19-4ab6-8d5a-7d28108936b6',
} as const;

const DIAGRAMLY_FORGE_APP_ID = FORGE_APP_ID_BY_PRODUCT.diagramly;

test('identifies only the target app page-banner first-seen relay', () => {
  expect(isTargetFirstSeenRelay({
    variables: {
      input: {
        extensionId: `ari:cloud:ecosystem::extension/${DIAGRAMLY_FORGE_APP_ID}/environment/static/zenuml-page-banner`,
        payload: {
          call: { path: 'https://conf-lite.zenuml.com/forge-user-behavior' },
          context: { moduleKey: 'zenuml-page-banner' },
        },
      },
    },
  }, DIAGRAMLY_FORGE_APP_ID)).toBe(true);
});

test('first-seen ping completes from the target app page-banner', async ({ page }) => {
  test.setTimeout(120_000);

  // The shared auth-state.json this project's `auth` dependency produces is
  // CACHED ACROSS CI RUNS (daily key, `.github/workflows/e2e-test.yml`'s
  // "Restore cached auth session" step) — its capture navigates to
  // `${baseUrl}/overview`, which itself mounts the page-banner and fires this
  // same ping (src/utils/firstSeen/firstSeenPing.ts), writing the 30-day
  // `appFirstSeen:<domain>` throttle marker INTO the cached storageState. Any
  // run later the same day that restores that cache starts with the marker
  // already fresh, so `maybeSendFirstSeenPing` short-circuits on its
  // synchronous `isFirstSeenDue` check and no relay call is ever made — this
  // spec then times out waiting for a response that was never going to arrive
  // (observed on lite-stg/diagramly-stg release runs 2026-08-14 and
  // 2026-08-16; deploy jobs were green both times because this is purely a
  // test-state artifact, not a product defect). Clear the marker (and its
  // paired attempt-backoff stamp) in every frame BEFORE the navigation that
  // this test's assertion depends on, so the spec's own pass/fail is never at
  // the mercy of whichever run happened to populate the shared cache first
  // that day. try/catch: a sandboxed cross-origin frame without
  // allow-same-origin may reject localStorage access entirely.
  await page.addInitScript(() => {
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('appFirstSeen')) window.localStorage.removeItem(key);
      }
    } catch {
      // inaccessible in this frame — nothing to clear
    }
  });

  const targetAppId = FORGE_APP_ID_BY_PRODUCT[testConfig.productType];
  const relayResponse = page.waitForResponse((response) => {
    if (!response.url().includes('useInvokeExtensionRelayMutation')) return false;
    try {
      return isTargetFirstSeenRelay(response.request().postDataJSON(), targetAppId);
    } catch {
      return false;
    }
  }, { timeout: 60_000 });

  await page.goto(testConfig.pageUrl(testConfig.parentPageId));

  const relayPayload = await (await relayResponse).json();
  expect(isSuccessfulForgeRelay(relayPayload)).toBe(true);
});
