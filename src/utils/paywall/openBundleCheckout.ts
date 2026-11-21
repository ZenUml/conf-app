import { openUrlForOutcome, type OpenUrlOutcome } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { Surface } from '@/utils/analytics/catalog'
import type { BundleCheckoutSurface } from './enterpriseBundleCheckout'

/**
 * Open the Bundle checkout handoff page. Opens are counted by the server
 * (bundle_checkout_redirected); only a failed open is sent from here, so a
 * regression that brings back Atlassian's external-page dialog shows up as
 * `declined`.
 */
export async function openBundleCheckout(
  url: string,
  ctx: { surface: Surface; checkoutSurface: BundleCheckoutSurface },
): Promise<OpenUrlOutcome> {
  const outcome = await openUrlForOutcome(url)
  if (outcome !== 'opened') {
    let params: URLSearchParams | undefined
    try { params = new URL(url).searchParams } catch { params = undefined }
    const ref = params?.get('ref')
    const click = params?.get('click')
    trackAnalyticsEvent('bundle_checkout_open_result', {
      feature_area: 'upgrade',
      surface: ctx.surface,
      checkout_surface: ctx.checkoutSurface,
      ...(ref ? { client_reference_id: ref } : {}),
      ...(click ? { checkout_click_id: click } : {}),
      checkout_open_outcome: outcome,
    })
  }
  return outcome
}
