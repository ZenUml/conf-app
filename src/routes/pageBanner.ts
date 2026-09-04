import { createApp } from 'vue';
import globals from '@/model/globals';
import { shouldShowPaywallBanner, deriveWarningBannerIdentity } from '@/utils/paywall/warningBanner';
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe';
import { isCsatPendingFresh } from '@/utils/csat';
import { deriveUnplacedIdentity, isUnplacedBannerCandidate } from '@/utils/byline/unplacedMarker';

/**
 * Single `confluence:pageBanner` host. Confluence creates exactly one banner
 * iframe per page; this host decides — centrally and synchronously, from
 * localStorage only — which banner (if any) it shows. Because the priority is
 * resolved in one place, the banners never need to coordinate across iframes
 * (this replaces the old two-module + CSAT-defer arrangement, which is why no
 * defer exists here).
 *
 * Priority: the paywall warning (unpaid Lite space over the hard limit, seen by
 * a recent macro author or by a space admin of that space) outranks the CSAT
 * survey, which outranks the unplaced-diagram notice. `none` means close the
 * iframe with no work.
 *
 * Why `unplaced` sits LAST despite being the most page-specific of the three:
 * it is the only one that keeps. The paywall warning is about work the user is
 * being blocked from doing right now, and a CSAT trigger is fresh for hours —
 * miss its window and the answer is gone. A diagram saved on this page and
 * placed nowhere is still saved on this page and placed nowhere tomorrow, and
 * its banner re-arms itself on the next load. Deferring it costs nothing;
 * deferring either of the others loses the moment.
 *
 * decidePageBanner() depends only on cheap localStorage predicates, so
 * forgeIndex can run it on the hot path (every page load) to decide whether to
 * close immediately. The heavy banner components load lazily — only when a
 * banner will actually show — inside handlePageBannerRoute().
 */
export type PageBannerChoice =
  | 'paywall'
  | 'paywall-admin'
  | 'csat'
  /** From the shared host, off the localStorage fallback marker. */
  | 'unplaced'
  /**
   * From the dedicated `zenuml-unplaced-banner` module, which Confluence has
   * already gated on the content property. Same component, different store —
   * separate choices so the component knows which one to read, exactly as
   * `paywall` / `paywall-admin` name which gate admitted them.
   */
  | 'unplaced-property'
  | 'none';

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
  if (isCurrentUserSpaceAdmin(identity) && shouldShowPaywallBanner(now, identity, true)) {
    return 'paywall-admin';
  }
  if (isCsatPendingFresh(now)) return 'csat';
  // Candidate, not verdict: this reads only the marker the byline left behind
  // (utils/byline/unplacedMarker.ts). The component pays for the page ADF read
  // that confirms it, and closes without a word if it cannot.
  if (isUnplacedBannerCandidate(deriveUnplacedIdentity(), now)) return 'unplaced';
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
  choice: 'paywall' | 'paywall-admin' | 'csat' | 'unplaced' | 'unplaced-property',
  now: number = Date.now(),
): Promise<PageBannerChoice> {
  let effective = choice;

  // Flag check happens here, not in decidePageBanner, so it costs nothing on the
  // ~99% of loads that show no banner. When off, the admin impression is dropped
  // and we fall back to whatever the pre-Phase-5b logic would have shown.
  if (effective === 'paywall-admin') {
    const { isAdminBannerEnabled } = await import('@/utils/paywall/adminBannerFlag');
    if (!(await isAdminBannerEnabled())) {
      // Deliberately NOT resumed down the rest of the priority list. This
      // branch predates the unplaced notice and belongs to the paywall banner's
      // kill switch; widening it would change what a flagged-off admin sees for
      // reasons that have nothing to do with the flag. The unplaced notice
      // reaches this page through its own gated module anyway.
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

  // One table, read once. Each choice names its component and the props that
  // choice implies — both are decided HERE rather than re-derived downstream:
  // the audience so a flagged-off admin who also qualifies as a recent author
  // still sees the old author copy, and the unplaced source because working it
  // out in the component would cost a property read on the very path that has
  // no property.
  const MOUNTS: Record<Exclude<PageBannerChoice, 'none'>, () => Promise<{ component: unknown; props?: object }>> = {
    paywall: async () => ({ component: (await import('@/components/UpgradePrompt/PaywallWarningBanner.vue')).default }),
    'paywall-admin': async () => ({
      component: (await import('@/components/UpgradePrompt/PaywallWarningBanner.vue')).default,
      props: { isSpaceAdmin: true },
    }),
    csat: async () => ({ component: (await import('@/components/CSAT/CsatBanner.vue')).default }),
    unplaced: async () => ({
      component: (await import('@/components/Byline/UnplacedDiagramsBanner.vue')).default,
      props: { source: 'marker' },
    }),
    'unplaced-property': async () => ({
      component: (await import('@/components/Byline/UnplacedDiagramsBanner.vue')).default,
      props: { source: 'property' },
    }),
  };

  const { component, props } = await MOUNTS[effective]();
  createApp(component as any, props).mount(container);
  return effective;
}
