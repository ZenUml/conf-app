import { createApp } from 'vue';
import globals from '@/model/globals';
import { deriveUnplacedIdentity, isUnplacedBannerCandidate } from '@/utils/byline/unplacedMarker';
import { higherPriorityBannerPending } from '@/utils/banners/priority';
import { whatsNewCandidate } from '@/utils/whatsNew/state';
import type { TargetedSurveyCandidate } from '@/features/targetedSurvey/survey';

/**
 * Single `confluence:pageBanner` host. Confluence creates exactly one banner
 * iframe per page; this host decides existing priority synchronously from
 * localStorage, then tries an authenticated targeted survey as a fallback.
 * Because the priority is
 * resolved in one place, the banners never need to coordinate across iframes
 * (this replaces the old two-module + CSAT-defer arrangement, which is why no
 * defer exists here).
 *
 * Priority: the paywall warning (unpaid Lite space over the hard limit, seen by
 * a recent macro author or by a space admin of that space) outranks the CSAT
 * survey, which outranks the unplaced-diagram notice, which outranks the
 * "What's new" strip. The targeted survey is the asynchronous fallback
 * when all synchronous banners decline. `none` means they declined.
 *
 * "What's new" is last for the same reason `unplaced` is below the first two,
 * only more so: a release stays announceable for weeks and is capped at a few
 * impressions, so a load where it loses the slot costs nothing. Everything
 * above it is about this user's work on this page.
 *
 * Why `unplaced` sits below those two despite being the most page-specific:
 * it is the only one that keeps. The paywall warning is about work the user is
 * being blocked from doing right now, and a CSAT trigger is fresh for hours —
 * miss its window and the answer is gone. A diagram saved on this page and
 * placed nowhere is still saved on this page and placed nowhere tomorrow, and
 * its banner re-arms itself on the next load. Deferring it costs nothing;
 * deferring either of the others loses the moment.
 *
 * decidePageBanner() depends only on cheap localStorage predicates, so
 * forgeIndex can run it on the hot path (every page load) to decide whether to
 * try the survey fallback. The heavy banner components load lazily — only when a
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
  | 'whats-new'
  | 'none';

/**
 * `paywall` and `paywall-admin` mount the same component; they are separate
 * choices so the caller knows WHICH gate admitted it.
 */
export function decidePageBanner(now: number = Date.now()): PageBannerChoice {
  // The same question the unplaced module asks itself, from the same reads —
  // see utils/banners/priority.ts for why it is asked twice rather than
  // implied by this cascade. forgeIndex awaits maybeProbeSpaceAdmin() BEFORE
  // calling this, so on the load that first resolves admin status the verdict
  // is already written: an admin sees the banner on that same load.
  const higher = higherPriorityBannerPending(now);
  if (higher) return higher;
  // Candidate, not verdict: this reads only the marker the byline left behind
  // (utils/byline/unplacedMarker.ts). The component pays for the page ADF read
  // that confirms it, and closes without a word if it cannot.
  if (isUnplacedBannerCandidate(deriveUnplacedIdentity(), now)) return 'unplaced';
  if (whatsNewCandidate(now)) return 'whats-new';
  return 'none';
}

/**
 * Mount the chosen banner. Each component keeps its own authoritative gate —
 * notably CsatBanner re-runs the async suppression check (checkStateOfCSAT) and
 * may still self-close — so CSAT behavior is preserved exactly; the host only
 * decides which component gets the single banner slot.
 *
 * Returns the choice actually mounted.
 */
export async function handlePageBannerRoute(
  choice: Exclude<PageBannerChoice, 'none'>,
  now: number = Date.now(),
): Promise<PageBannerChoice> {
  const effective = choice;

  const container = document.getElementById('app');
  if (!container) {
    console.error('[page-banner] #app container not found');
    return 'none';
  }
  await globals.apWrapper.initializeContext();

  // One table, read once. Each choice names its component and the props that
  // choice implies — both are decided HERE rather than re-derived downstream:
  // the audience, and the unplaced source because working it out in the
  // component would cost a property read on the very path that has no property.
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
    'whats-new': async () => ({
      component: (await import('@/components/WhatsNew/WhatsNewBanner.vue')).default,
      // Re-read rather than threaded through from decidePageBanner(): it is the
      // same synchronous localStorage read, and keeping the choice a plain
      // string keeps every other branch's signature unchanged.
      props: { release: whatsNewCandidate(now) },
    }),
  };

  const { component, props } = await MOUNTS[effective]();
  if (effective === 'whats-new' && !(props as { release?: unknown } | undefined)?.release) {
    // The release window closed between the decision and the mount (a
    // millisecond boundary). Nothing to say; never leave an empty frame open.
    const { view } = await import('@forge/bridge');
    view.close();
    return 'none';
  }
  createApp(component as any, props).mount(container);
  return effective;
}

/** Async Lite/Full fallback after every existing synchronous banner gate. */
export async function handleTargetedSurveyRoute(candidate: TargetedSurveyCandidate): Promise<void> {
  try {
    const container = document.getElementById('app');
    if (!container) throw new Error('missing banner container');
    await globals.apWrapper.initializeContext();
    const component = (await import('@/components/TargetedSurvey/TargetedSurveyBanner.vue')).default;
    createApp(component, candidate).mount(container);
  } catch {
    const { view } = await import('@forge/bridge');
    await view.close();
  }
}

/** Called from the host only when all synchronous banners declined their slot. */
export async function maybeHandleTargetedSurvey(productType: string | undefined): Promise<boolean> {
  if (productType !== 'lite' && productType !== 'full') return false;
  const { loadTargetedSurvey } = await import('@/features/targetedSurvey/survey');
  const candidate = await loadTargetedSurvey();
  if (!candidate) return false;
  await handleTargetedSurveyRoute(candidate);
  return true;
}
