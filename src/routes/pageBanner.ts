import { createApp } from 'vue';
import globals from '@/model/globals';
import { shouldShowPaywallBanner, deriveWarningBannerIdentity, readTargetingMarker } from '@/utils/paywall/warningBanner';
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe';
import { isCsatPendingFresh } from '@/utils/csat';
import { isInTemplateOfferBand, isTemplateOfferSuppressed } from '@/utils/template/templateOfferMarker';

/**
 * Single `confluence:pageBanner` host. Confluence creates exactly one banner
 * iframe per page; this host decides — centrally and synchronously, from
 * localStorage only — which banner (if any) it shows. Because the priority is
 * resolved in one place, the banners never need to coordinate across iframes
 * (this replaces the old two-module + CSAT-defer arrangement, which is why no
 * defer exists here).
 *
 * Priority: paywall author > paywall admin > Lite template offer > CSAT.
 * `none` means close the iframe with no work.
 *
 * decidePageBanner() depends only on cheap localStorage predicates, so
 * forgeIndex can run it on the hot path (every page load) to decide whether to
 * close immediately. The heavy banner components load lazily — only when a
 * banner will actually show — inside handlePageBannerRoute().
 */
export type PageBannerChoice = 'paywall' | 'paywall-admin' | 'template-offer' | 'csat' | 'none';

/**
 * `paywall` and `paywall-admin` mount the same component; they are separate
 * choices so the caller knows WHICH gate admitted it. `paywall-admin` is an
 * impression that did not exist before Phase 5b, and only it is subject to the
 * flag — keeping the pre-existing path free of any async work.
 */
export function decidePageBanner(now: number = Date.now()): PageBannerChoice {
  const identity = deriveWarningBannerIdentity();
  // Pre-Phase-5b gate first: if this user qualified as a recent author, nothing
  // about their experience changes and no flag is involved.
  if (shouldShowPaywallBanner(now, identity, false)) return 'paywall';
  // The admin verdict is a third localStorage read, still synchronous. forgeIndex
  // awaits maybeProbeSpaceAdmin() BEFORE calling this, so on the load that first
  // resolves admin status the verdict is already written — an admin sees the
  // banner on that same load, not the next one.
  const isSpaceAdmin = isCurrentUserSpaceAdmin(identity);
  if (isSpaceAdmin && shouldShowPaywallBanner(now, identity, true)) {
    return 'paywall-admin';
  }
  if (import.meta.env.PRODUCT_TYPE === 'lite' && isSpaceAdmin) {
    const macroCount = readTargetingMarker(identity)?.macroCount;
    if (isInTemplateOfferBand(macroCount) && !isTemplateOfferSuppressed(identity, now)) {
      return 'template-offer';
    }
  }
  if (isCsatPendingFresh(now)) return 'csat';
  return 'none';
}

/**
 * Mount the chosen banner. Each component keeps its own authoritative gate —
 * notably CsatBanner re-runs the async suppression check (checkStateOfCSAT) and
 * may still self-close — so CSAT behavior is preserved exactly; the host only
 * decides which component gets the single banner slot.
 *
 * Returns the choice actually mounted, which differs from the argument when the
 * admin banner is gated off.
 */
export async function handlePageBannerRoute(
  choice: 'paywall' | 'paywall-admin' | 'template-offer' | 'csat',
  now: number = Date.now(),
): Promise<PageBannerChoice> {
  let effective = choice;
  // Preserve the exact count that admitted this impression. A macro iframe can
  // refresh the shared targeting marker while context/component imports await;
  // re-reading afterwards could show an out-of-band count in an already-chosen
  // offer (observed on Lite staging as 60 becoming 8014 during mount).
  const templateOfferMacroCount = choice === 'template-offer'
    ? readTargetingMarker(deriveWarningBannerIdentity())?.macroCount ?? 0
    : 0;

  // Flag check happens here, not in decidePageBanner, so it costs nothing on the
  // ~99% of loads that show no banner. When off, the admin impression is dropped
  // and we fall back to whatever the pre-Phase-5b logic would have shown.
  if (effective === 'paywall-admin') {
    const { isAdminBannerEnabled } = await import('@/utils/paywall/adminBannerFlag');
    if (!(await isAdminBannerEnabled())) {
      if (!isCsatPendingFresh(now)) return 'none';
      effective = 'csat';
    }
  }

  const container = document.getElementById('app');
  if (!container) {
    console.error('[page-banner] #app container not found');
    return 'none';
  }
  await globals.apWrapper.initializeContext();
  const Component = effective === 'csat'
    ? (await import('@/components/CSAT/CsatBanner.vue')).default
    : effective === 'template-offer'
      ? (await import('@/components/UpgradePrompt/TemplateOfferBanner.vue')).default
      : (await import('@/components/UpgradePrompt/PaywallWarningBanner.vue')).default;
  // The audience is passed in rather than re-derived so that a flagged-off admin
  // who ALSO qualifies as a recent author still sees the old author copy.
  const props = effective === 'paywall-admin'
    ? { isSpaceAdmin: true }
    : effective === 'template-offer'
      ? { macroCount: templateOfferMacroCount }
      : undefined;
  createApp(Component, props).mount(container);
  return effective;
}
