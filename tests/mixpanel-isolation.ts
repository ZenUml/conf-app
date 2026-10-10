import type { BrowserContext } from '@playwright/test';

// Mixpanel's browser SDK sends XHR and unload beacons to api-js; some callers
// use api. Fulfill at context scope so Forge's out-of-process iframes are covered
// and request listeners in analytics tests can still inspect the original body.
const MIXPANEL_API_HOSTS = [
  '**://api-js.mixpanel.com/**',
  '**://api.mixpanel.com/**',
] as const;

export async function installMixpanelIsolation(context: BrowserContext): Promise<void> {
  for (const host of MIXPANEL_API_HOSTS) {
    await context.route(host, async route => {
      const request = route.request();
      const origin = request.headers().origin ?? '*';
      const headers = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? 'content-type',
        'Vary': 'Origin',
      };

      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers });
      } else {
        // mixpanel-browser 2.83.0 mixpanel-core.js _send_request calls back
        // with Number(responseText) on HTTP 200, or JSONDecode in verbose mode.
        // request-batcher.js then removes non-error responses from its queue.
        // An abort could instead leave the batch queued for retry.
        await route.fulfill({ status: 200, body: '1', contentType: 'text/plain', headers });
      }
    });
  }
}
