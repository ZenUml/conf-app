import { createApp } from 'vue';
import globals from '@/model/globals';
import { shouldShowPaywallBanner } from '@/utils/paywall/warningBanner';
import { isCsatPendingFresh } from '@/utils/csat';

/**
 * Single `confluence:pageBanner` host. Confluence creates exactly one banner
 * iframe per page; this host decides — centrally and synchronously, from
 * localStorage only — which banner (if any) it shows. Because the priority is
 * resolved in one place, the banners never need to coordinate across iframes
 * (this replaces the old two-module + CSAT-defer arrangement, which is why no
 * defer exists here).
 *
 * Priority: the paywall warning (unpaid Lite space over the hard limit with
 * recent macro authoring activity) outranks the CSAT survey. `none` means close
 * the iframe with no work.
 *
 * decidePageBanner() depends only on the two cheap localStorage predicates, so
 * forgeIndex can run it on the hot path (every page load) to decide whether to
 * close immediately. The heavy banner components load lazily — only when a
 * banner will actually show — inside handlePageBannerRoute().
 */
export type PageBannerChoice = 'paywall' | 'csat' | 'none';

export function decidePageBanner(now: number = Date.now()): PageBannerChoice {
  if (shouldShowPaywallBanner(now)) return 'paywall';
  if (isCsatPendingFresh(now)) return 'csat';
  return 'none';
}

/**
 * Mount the chosen banner. Each component keeps its own authoritative gate —
 * notably CsatBanner re-runs the async suppression check (checkStateOfCSAT) and
 * may still self-close — so CSAT behavior is preserved exactly; the host only
 * decides which component gets the single banner slot.
 */
export async function handlePageBannerRoute(choice: 'paywall' | 'csat'): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    console.error('[page-banner] #app container not found');
    return;
  }
  await globals.apWrapper.initializeContext();
  const Component =
    choice === 'paywall'
      ? (await import('@/components/UpgradePrompt/PaywallWarningBanner.vue')).default
      : (await import('@/components/CSAT/CsatBanner.vue')).default;
  createApp(Component).mount(container);
}
