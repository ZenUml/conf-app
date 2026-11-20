// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  BUNDLE_PAYMENT_LINK,
  handleBundleCheckoutGo,
  handleBundleCheckoutPage,
  type BundleCheckoutEvent,
} from './bundleCheckout';

const REF = 'example-tenant__ENG';
const CLICK = 'c1d2e3f4-0000-4000-8000-000000000001';

function page(query: string, method = 'GET') {
  return new Request(`https://conf-lite.zenuml.com/bundle-checkout?${query}`, { method });
}

function go(query: string, method = 'GET') {
  return new Request(`https://conf-lite.zenuml.com/bundle-checkout/go?${query}`, { method });
}

function recorder() {
  const events: BundleCheckoutEvent[] = [];
  return { events, track: vi.fn(async (event: BundleCheckoutEvent) => { events.push(event); }) };
}

const validQuery = `ref=${REF}&space=ENG&surface=plan_usage&click=${CLICK}`;

describe('GET /bundle-checkout (handoff page)', () => {
  it('serves the handoff page with the space, site, price and a no-JS Continue link', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutPage(page(validQuery), { track, nonce: 'n0nce' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Opening secure checkout');
    expect(html).toContain('ENG');
    expect(html).toContain('example-tenant.atlassian.net');
    expect(html).toContain('$299 per year');
    expect(html).toContain('plus tax where applicable');
    expect(html).toContain('No Confluence admin needed');
    // A plain link, so the page works with scripts blocked.
    expect(html).toContain(`href="/bundle-checkout/go?ref=${REF}&amp;surface=plan_usage&amp;click=${CLICK}&amp;trigger=button"`);
  });

  it('allows only its own inline script, by nonce', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutPage(page(validQuery), { track, nonce: 'n0nce' });
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-n0nce'");
    expect(await res.text()).toContain('<script nonce="n0nce">');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('records bundle_checkout_redirected with the funnel join keys', async () => {
    const { track, events } = recorder();
    await handleBundleCheckoutPage(page(validQuery), { track, nonce: 'n' });
    expect(events).toEqual([{
      event: 'bundle_checkout_redirected',
      feature_area: 'upgrade',
      checkout_surface: 'plan_usage',
      client_reference_id: REF,
      client_domain: 'example-tenant',
      checkout_click_id: CLICK,
      handoff_outcome: 'served',
    }]);
  });

  it('escapes the displayed space key', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutPage(
      page(`ref=${REF}&space=${encodeURIComponent('<img src=x>')}&surface=plan_usage&click=${CLICK}`),
      { track, nonce: 'n' },
    );
    const html = await res.text();
    expect(html).not.toContain('<img src=x>');
  });

  it('falls back to the space key in the ref when no display key is given', async () => {
    const { track } = recorder();
    const html = await (await handleBundleCheckoutPage(page(`ref=${REF}`), { track, nonce: 'n' })).text();
    expect(html).toContain('>ENG<');
  });

  it.each([
    ['missing ref', 'surface=plan_usage'],
    ['bad characters', 'ref=example.com__ENG'],
    ['no space part', 'ref=example-tenant'],
    ['too long', `ref=${'a'.repeat(201)}`],
  ])('answers 400 for %s and records invalid_ref', async (_name, query) => {
    const { track, events } = recorder();
    const res = await handleBundleCheckoutPage(page(query), { track, nonce: 'n' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('This checkout link is not valid');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'bundle_checkout_redirected', handoff_outcome: 'invalid_ref' });
    expect(events[0]).not.toHaveProperty('client_reference_id');
  });

  it('drops a surface or click id that does not match the allowed shape', async () => {
    const { track, events } = recorder();
    await handleBundleCheckoutPage(page(`ref=${REF}&surface=evil&click=${'x'.repeat(100)}`), { track, nonce: 'n' });
    expect(events[0]).not.toHaveProperty('checkout_surface');
    expect(events[0]).not.toHaveProperty('checkout_click_id');
  });

  it('does not record a HEAD request', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutPage(page(validQuery, 'HEAD'), { track, nonce: 'n' });
    expect(res.status).toBe(200);
    expect(track).not.toHaveBeenCalled();
  });

  it('rejects other methods', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutPage(page(validQuery, 'POST'), { track, nonce: 'n' });
    expect(res.status).toBe(405);
  });
});

describe('GET /bundle-checkout/go', () => {
  it('redirects to the fixed Payment Link with the ref as client_reference_id', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutGo(go(`${validQuery}&trigger=auto`), { track });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BUNDLE_PAYMENT_LINK}?client_reference_id=${REF}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('records bundle_checkout_continued with the trigger and Stop state', async () => {
    const { track, events } = recorder();
    await handleBundleCheckoutGo(go(`${validQuery}&trigger=button&stopped=1`), { track });
    expect(events).toEqual([{
      event: 'bundle_checkout_continued',
      feature_area: 'upgrade',
      checkout_surface: 'plan_usage',
      client_reference_id: REF,
      client_domain: 'example-tenant',
      checkout_click_id: CLICK,
      checkout_trigger: 'button',
      countdown_stopped: true,
    }]);
  });

  it('treats an unknown trigger as a button press', async () => {
    const { track, events } = recorder();
    await handleBundleCheckoutGo(go(`ref=${REF}&trigger=whatever`), { track });
    expect(events[0]).toMatchObject({ checkout_trigger: 'button', countdown_stopped: false });
  });

  it('never redirects anywhere but the Payment Link', async () => {
    const { track } = recorder();
    const res = await handleBundleCheckoutGo(go(`ref=${REF}&next=https://evil.example`), { track });
    expect(res.headers.get('location')?.startsWith(`${BUNDLE_PAYMENT_LINK}?`)).toBe(true);
  });

  it('answers 400 for a bad ref and does not redirect', async () => {
    const { track, events } = recorder();
    const res = await handleBundleCheckoutGo(go('ref=bad.ref'), { track });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(events).toEqual([]);
  });

  it('still redirects when analytics fails', async () => {
    const track = vi.fn(async () => { throw new Error('mixpanel down'); });
    const res = await handleBundleCheckoutGo(go(validQuery), { track });
    expect(res.status).toBe(302);
  });
});
