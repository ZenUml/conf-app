// Enterprise Bundle checkout handoff (spec:
// docs/superpowers/specs/2026-11-20-bundle-checkout-path-design.md, Phase 1).
//
// Why this page exists: from a Forge macro, router.open('https://buy.stripe.com/…')
// shows Atlassian's "Opening external page" dialog, and only 2 of 18 sites
// that clicked the Bundle CTA reached Stripe (2026-10-21..11-19). The same
// call to a *.zenuml.com URL opens with no dialog (observed 2026-11-20 on
// production, for zenuml.com, conf-lite and conf-stg-lite). So the CTA opens
// GET /bundle-checkout here, which shows what the buyer is about to pay for
// and continues to Stripe after 10 seconds (or at once on Continue), through
// GET /bundle-checkout/go, which records the step and answers 302.
// The bar is driven by elapsed time after the first paint. A CSS transition
// on an element that has just left `hidden` sometimes has no start frame,
// so the bar opened already full (2 of 20 loads, 2026-11-21).
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
const COUNTDOWN_SECONDS = 10;

/** Progress of the handoff bar. `elapsedMs` is time since the first painted frame. */
export function handoffCountdown(elapsedMs: number, totalMs = COUNTDOWN_SECONDS * 1000): {
  ratio: number;
  secondsLeft: number;
  done: boolean;
} {
  const total = totalMs > 0 ? totalMs : 1;
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const ratio = Math.min(1, Math.max(0, elapsed / total));
  const done = elapsed >= total;
  const secondsLeft = done ? 0 : Math.max(0, Math.ceil((total - Math.max(0, elapsed)) / 1000));
  return { ratio, secondsLeft, done };
}

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
:root{--hi:#1C2024;--lo:#60646C;--hair:#D9D9E0;--pri:#0C66E4;--ok:#1F845A;--card:#E9F2FF}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--hi);font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.top{height:56px;border-bottom:.5px solid var(--hair);display:flex;align-items:center;gap:8px;padding:0 24px;font-weight:600}
.logo{width:24px;height:24px;border-radius:6px;background:var(--pri);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
main{max-width:568px;margin:0 auto;padding:40px 24px 56px}
.eye{margin:0;font-size:12px;line-height:16px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--pri)}
h1{font-size:28px;line-height:36px;font-weight:600;margin:8px 0 0}
.lead{color:var(--lo);margin:8px 0 0}
.card{display:flex;justify-content:space-between;gap:24px;background:var(--card);border-radius:12px;padding:24px;margin-top:24px}
.gets{flex:1;min-width:0}
.glabel{margin:0 0 12px;font-size:12px;line-height:16px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--lo)}
.benefit{display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:16px;line-height:24px;font-weight:500}
.benefit:first-of-type{margin-top:0}
.check{flex:0 0 20px;width:20px;height:20px;margin-top:2px}
.price{text-align:right;width:150px;flex:none}
.price strong{display:block;font-size:40px;line-height:48px;font-weight:700}
.price.offer strong{font-size:22px;line-height:28px}
.offer-note{margin:12px 0 0;color:var(--lo);font-size:12px;line-height:16px}
.price .per{display:block;font-size:14px;line-height:20px;font-weight:500}
.price small{display:block;margin-top:4px;font-size:12px;line-height:16px;font-weight:400;color:var(--lo)}
.pay{display:flex;align-items:center;gap:8px;margin-top:16px;color:var(--lo);font-size:13px;line-height:20px}
.lock{flex:none}
.acts{margin-top:24px}
.btn{display:flex;align-items:center;justify-content:center;height:44px;border-radius:8px;background:var(--pri);color:#fff;font-size:16px;font-weight:600;text-decoration:none}
.btn:focus-visible,.link:focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.count{margin-top:10px}
.bar{height:6px;background:var(--hair);border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;width:0;background:var(--pri);border-radius:3px}
.cd{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:13px;line-height:20px;color:var(--lo)}
.link{font:inherit;font-size:13px;line-height:20px;color:var(--pri);font-weight:500;background:none;border:0;padding:0;cursor:pointer}
.muted{display:block;margin-top:10px;color:var(--lo);font-size:13px;line-height:20px;text-align:center}
.fine{color:var(--lo);font-size:12px;line-height:16px;margin-top:24px}
[hidden]{display:none!important}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body><header class="top"><span class="logo" aria-hidden="true">Z</span>ZenUML</header>${body}</body></html>`;
}

const CHECK = '<svg class="check" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#1F845A"/><path d="M5.5 10.5l3 3 6-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg class="lock" width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="6" width="10" height="7" rx="1.5" fill="#60646C"/><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="#60646C" stroke-width="1.5"/></svg>';

function benefit(text: string): string {
  return `<div class="benefit">${CHECK}<span>${text}</span></div>`;
}

function handoffHtml(p: CheckoutParams, nonce: string | undefined, offer: boolean): string {
  const space = escapeHtml(p.displaySpace ?? (p.refSpaceKey as string));
  const site = escapeHtml(`${p.clientDomain}.atlassian.net`);
  const href = escapeHtml(goHref(p));
  const price = offer
    ? `<div class="price offer"><strong>${BLACK_FRIDAY_PRICE} first year</strong></div>`
    : `<div class="price"><strong>$${BUNDLE_ANNUAL_PRICE_USD}</strong><span class="per">per year</span><small>plus tax where applicable</small></div>`;
  const offerNote = offer ? `<p class="offer-note">${BLACK_FRIDAY_TERMS} Applied automatically at checkout.</p>` : '';
  // Without scripts the page shows its ready state and a working Continue
  // link. The script switches to the countdown and starts it once the tab is
  // visible, so a tab opened in the background does not leave on its own.
  // The first animation frame paints the bar at 0. Later frames set its width
  // from elapsed time, the same ratio as handoffCountdown.
  const script = nonce ? `<script nonce="${nonce}">(function(){
var a=document.getElementById('go'),stopped=false,raf=0;
var c=document.getElementById('count'),r=document.getElementById('ready'),n=document.getElementById('n'),bar=document.getElementById('bar');
var TOTAL=${COUNTDOWN_SECONDS * 1000};
function ready(){stopped=true;if(raf)cancelAnimationFrame(raf);raf=0;c.hidden=true;r.hidden=false;a.textContent='Continue to Stripe';a.href=a.getAttribute('href')+'&stopped=1';}
function frame(now,t0){
if(stopped)return;
if(t0===undefined){bar.style.width='0%';raf=requestAnimationFrame(function(t){frame(t,t);});return;}
var elapsed=now-t0;
var ratio=Math.min(1,Math.max(0,elapsed/TOTAL));
bar.style.width=(ratio*100)+'%';
var left=Math.ceil((TOTAL-elapsed)/1000);
if(left>0){n.textContent=left+(left===1?' second':' seconds');raf=requestAnimationFrame(function(t){frame(t,t0);});return;}
location.replace(a.href.replace('trigger=button','trigger=auto'));
}
function start(){if(raf||stopped)return;a.textContent='Continue to Stripe now';c.hidden=false;r.hidden=true;raf=requestAnimationFrame(function(t){frame(t);});}
document.getElementById('stop').addEventListener('click',ready);
if(document.visibilityState==='visible')start();else document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')start();});
})();</script>` : '';
  return shell('Secure checkout · ZenUML', `<main>
<p class="eye">Unlock one space</p>
<h1 id="h">Unlimited diagrams in ${space}</h1>
<p class="lead" id="lead">${site} · Stripe handles the payment for ZenUML</p>
<div class="card">
<div class="gets"><p class="glabel">You get</p>${benefit('No diagram limit in this space')}${benefit(`Covers ${space} only`)}${benefit('No Confluence admin needed')}${benefit('5 seats on diagramly.ai')}</div>
${price}
</div>
${offerNote}
<p class="pay">${LOCK}Pay by card on Stripe's secure checkout</p>
<div class="acts"><a class="btn" id="go" href="${href}">Continue to Stripe</a>
<div class="count" id="count" hidden><div class="bar" aria-hidden="true"><i id="bar"></i></div><div class="cd" role="status"><span>Opening Stripe in <span id="n">${COUNTDOWN_SECONDS} seconds</span></span><button type="button" class="link" id="stop">Stay on this page</button></div></div>
<p class="muted" id="ready">or close this tab to cancel</p></div>
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
