import { test, expect, installMixpanelIsolation } from '../fixtures/mixpanel-test.js';
import { captureMixpanelEvents } from '../helpers/macroViewedCapture.js';
import { waitForCopyForAiTrackingRequest } from '../helpers/CopyForAiHelper.js';

test('Mixpanel requests on both API hosts are acknowledged locally and remain observable', async ({ page, context, browser }) => {
  const seen: string[] = [];
  context.on('request', request => {
    if (request.url().includes('mixpanel.com/')) seen.push(request.postData() ?? '');
  });
  await context.route('https://fixture.example.test/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Fixture</title>',
  }));
  await context.route('https://forge-frame.invalid/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Forge frame</title>',
  }));
  await page.goto('https://fixture.example.test/');
  await context.setOffline(true);
  const captured = captureMixpanelEvents(context);
  const copyTracking = waitForCopyForAiTrackingRequest(page);

  const first = await page.evaluate(async () => {
    const response = await fetch('https://api-js.mixpanel.com/track/?ip=1', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(JSON.stringify([
        { event: 'macro_viewed', properties: { macro_type: 'sequence' } },
        { event: 'copy_for_ai_clicked', properties: { surface: 'viewer' } },
      ])),
    });
    return [response.status, await response.text()];
  });
  const second = await page.evaluate(async () => {
    const response = await fetch('https://api.mixpanel.com/import', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=server-host-payload',
    });
    return [response.status, await response.text()];
  });
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://forge-frame.invalid/';
    document.body.appendChild(iframe);
  });
  await expect.poll(() => page.frames().some(frame => frame.url() === 'https://forge-frame.invalid/')).toBe(true);
  const iframe = page.frames().find(frame => frame.url() === 'https://forge-frame.invalid/');
  expect(iframe).toBeDefined();
  const fromFrame = await iframe!.evaluate(async () => {
    const response = await fetch('https://api-js.mixpanel.com/track/', {
      method: 'POST', body: 'data=iframe-payload',
    });
    return [response.status, await response.text()];
  });
  const beaconResponse = page.waitForResponse(response =>
    response.url() === 'https://api-js.mixpanel.com/track/'
    && response.request().postData()?.includes('beacon-payload') === true,
  );
  const beaconRequest = page.waitForRequest(request =>
    request.url() === 'https://api-js.mixpanel.com/track/' && request.postData()?.includes('beacon-payload') === true,
  );
  expect(await page.evaluate(() => navigator.sendBeacon('https://api-js.mixpanel.com/track/', 'data=beacon-payload'))).toBe(true);
  await beaconRequest;
  expect((await beaconResponse).status()).toBe(200);

  expect(first).toEqual([200, '1']);
  expect(second).toEqual([200, '1']);
  expect(fromFrame).toEqual([200, '1']);
  expect(captured.forMacro('sequence')).toHaveLength(1);
  expect(await copyTracking).toMatchObject({ surface: 'viewer' });
  expect(seen.some(body => body.includes('copy_for_ai_clicked'))).toBe(true);
  expect(seen).toContain('data=server-host-payload');
  expect(seen).toContain('data=iframe-payload');
  expect(seen).toContain('data=beacon-payload');

  const manual = await browser.newContext();
  try {
    await installMixpanelIsolation(manual);
    const manualPage = await manual.newPage();
    await manual.route('https://fixture.example.test/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html>',
    }));
    await manualPage.goto('https://fixture.example.test/');
    await manual.setOffline(true);
    expect(await manualPage.evaluate(async () => {
      const response = await fetch('https://api-js.mixpanel.com/track/', {
        method: 'POST', body: 'data=manual-context',
      });
      return [response.status, await response.text()];
    })).toEqual([200, '1']);
  } finally {
    await manual.close();
  }
});
