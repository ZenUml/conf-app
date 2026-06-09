import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';

/**
 * Minimal asyncapi smoke. The variant's deployment surface is dominated by
 * one screen — the "My API Documents" space-page dashboard — and almost
 * every other surface (the editor modal, the viewer iframe) bottoms out in
 * the same forge custom-UI iframe + Studio bundle. Confirming the dashboard
 * paints "+ Create New API" is therefore enough to catch the regressions a
 * deploy is most likely to introduce:
 *
 *  - Forge install didn't complete (no iframe rendered)
 *  - Manifest stripped too aggressively (spacePage module missing)
 *  - Asyncapi vite bundle failed to load (white iframe / unhandled error)
 *  - ApWrapper search broke against the deployed backend (button never appears
 *    because the dashboard sits forever in its "Loading…" branch)
 *
 * Skips when the app profile isn't asyncapi so the same suite project can
 * coexist with the lite/full/diagramly runs without producing false noise.
 */

const APP_ID = '49017727-af19-4ab6-8d5a-7d28108936b6';
// Forge env IDs are stable per environment, set at env-creation time. Looked up
// via `APP_ID=49017727-... PRODUCT_TYPE=asyncapi pnpm exec forge environments
// list`. STAGING is the env wired by `pnpm forge:deploy:asyncapi:staging`.
const STAGING_ENV_ID = 'a75bfad8-d5f1-4487-8c75-704d0e0df3ab';
const ROUTE = 'zenuml-asyncapi-dashboard';

const skip = testConfig.productType !== 'asyncapi';

test.describe('AsyncAPI smoke', () => {
  test.skip(skip, `Profile ${testConfig.domain} is not the asyncapi variant`);

  test('"My API Documents" space-page loads', async ({ page, request }) => {
    // Discover any space on the site — the test should work regardless of
    // what space-key the user happens to have set up on asyncapi-stg.
    // Falls back to testConfig.spaceKey if the API call doesn't surface one.
    let spaceKey = testConfig.spaceKey;
    try {
      const resp = await request.get(`https://${testConfig.domain}/wiki/api/v2/spaces?limit=1`);
      if (resp.ok()) {
        const data = await resp.json();
        const first = data?.results?.[0]?.key;
        if (typeof first === 'string' && first.length > 0) spaceKey = first;
      }
    } catch (e) {
      // Use profile default; failure surfaces below if the URL is wrong.
    }

    const url =
      `https://${testConfig.domain}` +
      `/wiki/spaces/${spaceKey}` +
      `/apps/${APP_ID}/${STAGING_ENV_ID}/${ROUTE}`;
    console.log(`▶ AsyncAPI dashboard: ${url}`);

    await page.goto(url);

    // Forge renders the custom UI inside a CDN-hosted iframe. A vanilla
    // Confluence page actually mounts at least one OTHER Forge iframe (the
    // app-strip rail in the left nav, plus any other installed Forge apps),
    // so a bare `iframe[src*="cdn.prod.atlassian-dev.net"]` selector trips
    // Playwright's strict-mode resolved-to-N-elements check. Scope the match
    // to this app's APP_ID — Forge bakes the app id into every iframe URL
    // — so we pick the asyncapi iframe specifically.
    const frame = page.frameLocator(`iframe[src*="${APP_ID}"]`);
    // The dashboard's "+ Create New API" button is the strongest "rendered
    // end-to-end" signal: it's after the search call to v2/custom-content
    // has resolved AND after the Vue tree has hydrated.
    await expect(frame.getByRole('button', { name: /create new api/i })).toBeVisible({
      timeout: 60000,
    });
  });
});
