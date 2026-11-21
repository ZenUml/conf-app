import forgeGlobal from '@/model/globals/forgeGlobal'

/** Which Bundle CTA built the link; validated against the same list on the server. */
export type BundleCheckoutSurface = 'plan_usage' | 'upgrade_prompt'

/** Production Lite backend, for surfaces that run before the Forge context resolves. */
const FALLBACK_BACKEND_BASE_URL = 'https://conf-lite.zenuml.com'

function newClickId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

/**
 * The Bundle checkout link for one space. It opens our handoff page
 * (functions/bundle-checkout) on the variant's backend host, which continues
 * to the Stripe Payment Link. router.open shows Atlassian's external-page
 * dialog for buy.stripe.com but not for *.zenuml.com (observed 2026-11-20).
 *
 * `clientReferenceId` (`<domain>__<spaceKey>`, Stripe's [A-Za-z0-9_-], at most
 * 200 characters) is what the payment carries back to the webhook. `space`
 * keeps the real key for display. `clickId` joins the click event to the
 * server events without a user id in the URL.
 */
export function enterpriseBundleCheckout(
  clientDomain: string,
  spaceKey: string,
  opts: { surface: BundleCheckoutSurface; baseUrl?: string; clickId?: string },
) {
  const clientReferenceId = `${clientDomain}__${spaceKey}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)
  const clickId = opts.clickId ?? newClickId()
  const base = (opts.baseUrl ?? forgeGlobal.zenumlRemoteBaseUrl ?? FALLBACK_BACKEND_BASE_URL).replace(/\/+$/, '')
  const query = new URLSearchParams({ ref: clientReferenceId, space: spaceKey, surface: opts.surface, click: clickId })
  return { clientReferenceId, clickId, url: `${base}/bundle-checkout?${query.toString()}` }
}
