import { test, expect } from '@playwright/test';
import { testConfig } from '../config/test-config.js';

test('loaded Forge frontend matches pinned build marker', async ({ page }, testInfo) => {
  const expected = process.env.EXPECTED_APP_VERSION;
  expect(expected, 'EXPECTED_APP_VERSION must identify pinned CI build').toMatch(/^ci-[a-f0-9]{40}-(lite|full|diagramly|asyncapi)$/);
  expect(expected!.endsWith(`-${testConfig.productType}`)).toBe(true);
  let pageId = process.env.REGRESSION_VERSION_PAGE;
  if (!pageId) {
    const email = process.env.FORGE_EMAIL;
    const token = process.env.FORGE_API_TOKEN;
    expect(email && token, 'Confluence REST credentials required for read-only fixture discovery').toBeTruthy();
    const origin = `https://${testConfig.domain}`;
    let next = `${origin}/wiki/api/v2/pages?limit=100&body-format=storage`;
    for (let index = 0; index < 5 && next && !pageId; index++) {
      const response = await page.request.get(next, { headers: { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` }, timeout: 15000 });
      expect(response.ok(), 'Fixture discovery API request must succeed').toBe(true);
      const body = await response.json();
      const macro = testConfig.productType === 'asyncapi' ? 'zenuml-asyncapi-macro' : testConfig.sequenceMacroKey;
      pageId = body.results?.find((item: any) => typeof item.body?.storage?.value === 'string' && item.body.storage.value.includes(macro))?.id;
      const raw = body._links?.next;
      if (!raw) break;
      const resolved = new URL(raw, origin);
      expect(resolved.origin, 'Pagination must stay on configured Confluence site').toBe(origin);
      next = resolved.href;
    }
  }
  expect(pageId, 'Existing page containing this variant macro must be available').toBeTruthy();
  let observed = false;
  const pending: Promise<void>[] = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname.endsWith('.cdn.prod.atlassian-dev.net') && /\.js(?:$|\?)/.test(response.url()) && response.ok()) {
      pending.push(response.text().then(body => { if (body.includes(expected!)) observed = true; }).catch(() => {}));
    }
  });
  await page.goto(testConfig.pageUrl(pageId!), { waitUntil: 'domcontentloaded' });
  try {
    await expect.poll(() => observed, { timeout: 60000, message: 'Loaded Forge CDN JavaScript must contain exact pinned build marker' }).toBe(true);
  } finally {
    await Promise.allSettled(pending);
    await page.screenshot({ path: testInfo.outputPath('pinned-frontend.png'), fullPage: true });
    await testInfo.attach('pinned-frontend-version', { body: JSON.stringify({ expected, observed }), contentType: 'application/json' });
  }
});
