// Enterprise Bundle checkout handoff (spec:
// docs/superpowers/specs/2026-11-20-bundle-checkout-path-design.md, Phase 1).
//
// Why this page exists: from a Forge macro, router.open('https://buy.stripe.com/…')
// shows Atlassian's "Opening external page" dialog, and only 2 of 18 sites
// that clicked the Bundle CTA reached Stripe (2026-10-21..11-19). The same
// call to a *.zenuml.com URL opens with no dialog (observed 2026-11-20 on
// production, for zenuml.com, conf-lite and conf-stg-lite). So the CTA opens
// GET /bundle-checkout here, which shows what the buyer is about to pay for
// and continues to Stripe after 3 seconds (or at once on Continue), through
// GET /bundle-checkout/go, which records the step and answers 302.
//
// Trust: `ref` comes from the client, exactly as client_reference_id did when
// the CTA linked to Stripe directly. The redirect target is a constant, so
// this is not an open redirect. Nothing here needs or reads a user identity.

import {
  BLACK_FRIDAY_OFFER, BLACK_FRIDAY_PRICE, BLACK_FRIDAY_STRIPE_CODE, BLACK_FRIDAY_TERMS,
  BUNDLE_ANNUAL_PRICE_USD, blackFridayActive,
} from '../../src/utils/paywall/bundleBlackFriday';

export const BUNDLE_PAYMENT_LINK = 'https://buy.stripe.com/cNifZifkN7hzavK12H7IY05';
export { BUNDLE_ANNUAL_PRICE_USD };
const COUNTDOWN_SECONDS = 3;

const REF_RE = /^[A-Za-z0-9_-]{1,200}$/;
const CLICK_RE = /^[A-Za-z0-9-]{8,64}$/;
const DISPLAY_SPACE_RE = /^[^\u0000-\u001f]{1,100}$/;
const SURFACES = ['plan_usage', 'upgrade_prompt'] as const;
type Surface = typeof SURFACES[number];

export interface BundleCheckoutEvent {
  event: 'bundle_checkout_redirected' | 'bundle_checkout_continued';
  feature_area: 'upgrade';
  checkout_surface?: Surface;
  client_reference_id?: string;
  client_domain?: string;
  checkout_click_id?: string;
  handoff_outcome?: 'served' | 'invalid_ref';
  checkout_trigger?: 'auto' | 'button';
  countdown_stopped?: boolean;
  bundle_offer?: typeof BLACK_FRIDAY_OFFER;
}

export interface BundleCheckoutDeps {
  track: (event: BundleCheckoutEvent) => Promise<void>;
  /** Pages `waitUntil`; without it the event is awaited (tests). */
  waitUntil?: (work: Promise<unknown>) => void;
  /** CSP nonce for the page's one inline script. */
  nonce?: string;
  stripePromotionCode?: string | null;
  now?: () => number;
}

interface CheckoutParams {
  ref: string | null;
  clientDomain?: string;
  refSpaceKey?: string;
  displaySpace?: string;
  surface?: Surface;
  click?: string;
  wantsOffer: boolean;
}

function parseParams(url: URL): CheckoutParams {
  const rawRef = url.searchParams.get('ref');
  const split = rawRef && REF_RE.test(rawRef) ? rawRef.indexOf('__') : -1;
  const ref = rawRef && split > 0 && split + 2 < rawRef.length ? rawRef : null;
  const surface = url.searchParams.get('surface');
  const click = url.searchParams.get('click');
  const space = url.searchParams.get('space');
  return {
    ref,
    wantsOffer: url.searchParams.get('offer') === BLACK_FRIDAY_OFFER,
    clientDomain: ref ? ref.slice(0, split) : undefined,
    refSpaceKey: ref ? ref.slice(split + 2) : undefined,
    displaySpace: space && DISPLAY_SPACE_RE.test(space) ? space : undefined,
    surface: SURFACES.includes(surface as Surface) ? (surface as Surface) : undefined,
    click: click && CLICK_RE.test(click) ? click : undefined,
  };
}

function baseEvent(event: BundleCheckoutEvent['event'], p: CheckoutParams): BundleCheckoutEvent {
  return {
    event,
    feature_area: 'upgrade',
    ...(p.surface ? { checkout_surface: p.surface } : {}),
    ...(p.ref ? { client_reference_id: p.ref, client_domain: p.clientDomain } : {}),
    ...(p.click ? { checkout_click_id: p.click } : {}),
  };
}

/** Analytics never fails or delays the response beyond a short timeout. */
async function record(deps: BundleCheckoutDeps, event: BundleCheckoutEvent): Promise<void> {
  const work = Promise.race([
    deps.track(event),
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => undefined);
  if (deps.waitUntil) deps.waitUntil(work);
  else await work;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function goHref(p: CheckoutParams): string {
  const q = new URLSearchParams({ ref: p.ref as string });
  if (p.surface) q.set('surface', p.surface);
  if (p.click) q.set('click', p.click);
  if (p.wantsOffer) q.set('offer', BLACK_FRIDAY_OFFER);
  q.set('trigger', 'button');
  return `/bundle-checkout/go?${q.toString()}`;
}

function headers(nonce?: string): Record<string, string> {
  const script = nonce ? ` script-src 'nonce-${nonce}';` : '';
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none';${script} style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}

const STYLE = `
:root{--hi:#1C2024;--lo:#60646C;--hair:#D9D9E0;--ctl:#CDCED6;--pri:#0C66E4}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--hi);font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.top{height:56px;border-bottom:.5px solid var(--hair);display:flex;align-items:center;gap:8px;padding:0 24px;font-weight:600}
.logo{width:24px;height:24px;border-radius:6px;background:var(--pri);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
main{max-width:480px;margin:0 auto;padding:56px 24px}
h1{font-size:24px;line-height:32px;font-weight:600;margin:0}
.lead{color:var(--lo);margin:8px 0 24px}
.card{border:.5px solid var(--ctl);border-radius:8px}
.row{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:.5px solid var(--hair)}
.offer{background:#f3eefd;color:#4c2981;border-radius:8px;padding:12px 16px;margin-bottom:16px}
.offer strong,.offer small{display:block}
.row:last-child{border-bottom:0}
.k{color:var(--lo)}.v{font-weight:500;text-align:right;overflow-wrap:anywhere}
.v small{display:block;font-weight:400;color:var(--lo);font-size:12px;line-height:16px}
.count{margin-top:24px}
.bar{height:4px;background:var(--hair);border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;width:0;background:var(--pri);transition:width ${COUNTDOWN_SECONDS}s linear}
.cd{display:flex;justify-content:space-between;margin-top:8px;font-size:12px;line-height:16px;color:var(--lo)}
.link{font:inherit;color:var(--pri);font-weight:500;background:none;border:0;padding:0;cursor:pointer}
.acts{display:flex;align-items:center;gap:8px;margin-top:20px}
.btn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:6px;background:var(--pri);color:#fff;font-weight:500;text-decoration:none}
.btn:focus-visible,.link:focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.muted{color:var(--lo);font-size:12px;line-height:16px}
.fine{color:var(--lo);font-size:12px;line-height:16px;margin-top:24px}
[hidden]{display:none!important}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body><header class="top"><span class="logo" aria-hidden="true">Z</span>ZenUML</header>${body}</body></html>`;
}

function handoffHtml(p: CheckoutParams, nonce: string | undefined, offer: boolean): string {
  const space = escapeHtml(p.displaySpace ?? (p.refSpaceKey as string));
  const site = escapeHtml(`${p.clientDomain}.atlassian.net`);
  const href = escapeHtml(goHref(p));
  // Without scripts the page shows its ready state and a working Continue
  // link. The script switches to the countdown and starts it once the tab is
  // visible, so a tab opened in the background does not leave on its own.
  const script = nonce ? `<script nonce="${nonce}">(function(){
var a=document.getElementById('go'),t=null,stopped=false;
var h=document.getElementById('h'),l=document.getElementById('lead'),c=document.getElementById('count'),r=document.getElementById('ready'),n=document.getElementById('n'),bar=document.getElementById('bar');
function ready(){stopped=true;if(t)clearTimeout(t);t=null;c.hidden=true;r.hidden=false;h.textContent='Checkout is ready';l.textContent='Stripe handles the payment for ZenUML. Continue when you are ready.';a.textContent='Continue to Stripe';a.href=a.getAttribute('href')+'&stopped=1';}
function start(){if(t||stopped)return;var left=${COUNTDOWN_SECONDS};requestAnimationFrame(function(){bar.style.width='100%';});
t=setInterval(function(){left-=1;if(left>0){n.textContent=left+(left===1?' second':' seconds');return;}clearInterval(t);location.replace(a.href.replace('trigger=button','trigger=auto'));},1000);}
h.textContent='Opening secure checkout';l.textContent='Stripe handles the payment for ZenUML. Check the details below.';a.textContent='Continue to Stripe now';c.hidden=false;r.hidden=true;
document.getElementById('stop').addEventListener('click',ready);
if(document.visibilityState==='visible')start();else document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')start();});
})();</script>` : '';
  return shell('Secure checkout · ZenUML', `<main>
<h1 id="h">Checkout is ready</h1>
<p class="lead" id="lead">Stripe handles the payment for ZenUML. Continue when you are ready.</p>
${offer ? `<div class="offer"><strong>Black Friday · 50% off the first year</strong><strong>${BLACK_FRIDAY_PRICE} first year</strong><small>${BLACK_FRIDAY_TERMS}</small><small>Applied automatically at checkout.</small></div>` : ''}
<div class="card">
<div class="row"><span class="k">Space</span><span class="v">${space}<small>${site}</small></span></div>
${offer ? '' : `<div class="row"><span class="k">Price</span><span class="v">$${BUNDLE_ANNUAL_PRICE_USD} per year<small>plus tax where applicable</small></span></div>`}
<div class="row"><span class="k">You get</span><span class="v">No diagram limit in this space<small>for this space only</small></span></div>
<div class="row"><span class="k">Payment</span><span class="v">Card, by Stripe<small>No Confluence admin needed</small></span></div>
</div>
<div class="count" id="count" hidden><div class="bar"><i id="bar"></i></div><div class="cd" role="status"><span>Opening Stripe in <span id="n">${COUNTDOWN_SECONDS} seconds</span></span><button type="button" class="link" id="stop">Stop</button></div></div>
<div class="acts"><a class="btn" id="go" href="${href}">Continue to Stripe</a><span class="muted" id="ready">or close this tab to cancel</span></div>
<p class="fine">Stripe may show our registered company name on the checkout page and on your card statement.</p>
</main>${script}`);
}

const INVALID_HTML = shell('Checkout link not valid · ZenUML', `<main>
<h1>This checkout link is not valid</h1>
<p class="lead">The link is missing the space it should unlock, so we did not open checkout.</p>
<p>Go back to Plan and usage in Confluence and select Unlock this space again.</p>
<p class="fine">Still not working? Email support@zenuml.com and include the space key.</p>
</main>`);

function promotionCode(p: CheckoutParams, deps: BundleCheckoutDeps): string | null {
  if (!p.wantsOffer || !p.surface || !blackFridayActive(deps.now?.() ?? Date.now())) return null;
  return deps.stripePromotionCode === undefined ? BLACK_FRIDAY_STRIPE_CODE : deps.stripePromotionCode;
}

function unavailableOffer(p: CheckoutParams): Response {
  const query = new URLSearchParams({ ref: p.ref as string });
  if (p.displaySpace) query.set('space', p.displaySpace);
  if (p.surface) query.set('surface', p.surface);
  if (p.click) query.set('click', p.click);
  const href = escapeHtml(`/bundle-checkout?${query}`);
  return new Response(shell('Black Friday offer unavailable · ZenUML', `<main>
<h1>The Black Friday offer is unavailable</h1>
<p class="lead">You can still unlock this space for US$${BUNDLE_ANNUAL_PRICE_USD} per year, plus tax where applicable.</p>
<p><a class="btn" href="${href}">Review standard checkout</a></p>
</main>`), { status: 409, headers: headers() });
}

function methodGuard(request: Request): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
}

/** GET /bundle-checkout — the handoff page. */
export async function handleBundleCheckoutPage(request: Request, deps: BundleCheckoutDeps): Promise<Response> {
  const refused = methodGuard(request);
  if (refused) return refused;
  const p = parseParams(new URL(request.url));
  const isHead = request.method === 'HEAD';
  if (!p.ref) {
    if (!isHead) await record(deps, { ...baseEvent('bundle_checkout_redirected', p), handoff_outcome: 'invalid_ref' });
    return new Response(INVALID_HTML, { status: 400, headers: headers() });
  }
  const code = promotionCode(p, deps);
  if (p.wantsOffer && !code) return unavailableOffer(p);
  if (!isHead) await record(deps, {
    ...baseEvent('bundle_checkout_redirected', p),
    handoff_outcome: 'served',
    ...(code ? { bundle_offer: BLACK_FRIDAY_OFFER } : {}),
  });
  return new Response(handoffHtml(p, deps.nonce, Boolean(code)), { status: 200, headers: headers(deps.nonce) });
}

/** GET /bundle-checkout/go — records the step and sends the buyer to Stripe. */
export async function handleBundleCheckoutGo(request: Request, deps: BundleCheckoutDeps): Promise<Response> {
  const refused = methodGuard(request);
  if (refused) return refused;
  const url = new URL(request.url);
  const p = parseParams(url);
  if (!p.ref) return new Response(INVALID_HTML, { status: 400, headers: headers() });
  const code = promotionCode(p, deps);
  if (p.wantsOffer && !code) return unavailableOffer(p);
  if (request.method === 'GET') {
    await record(deps, {
      ...baseEvent('bundle_checkout_continued', p),
      checkout_trigger: url.searchParams.get('trigger') === 'auto' ? 'auto' : 'button',
      countdown_stopped: url.searchParams.get('stopped') === '1',
      ...(code ? { bundle_offer: BLACK_FRIDAY_OFFER } : {}),
    });
  }
  const target = new URL(BUNDLE_PAYMENT_LINK);
  target.searchParams.set('client_reference_id', p.ref);
  if (code) target.searchParams.set('prefilled_promo_code', code);
  return new Response(null, { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
