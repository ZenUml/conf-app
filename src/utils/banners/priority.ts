import { deriveWarningBannerIdentity, shouldShowPaywallBanner } from '@/utils/paywall/warningBanner'
import { isCurrentUserSpaceAdmin } from '@/utils/paywall/spaceAdminProbe'
import { isCsatPendingFresh, isCsatSuppressed } from '@/utils/csat'

/**
 * Which banner outranks the unplaced-diagram notice on this page load.
 *
 * The page-banner host picks ONE of paywall / CSAT / unplaced, so inside that
 * host the order took care of itself. The unplaced notice then moved to its own
 * Confluence module (`zenuml-unplaced-banner`, gated server-side on a content
 * property), and a second module is a second iframe: Confluence renders both,
 * and the host's priority no longer reaches it. Observed in the wild — the
 * unplaced banner stacked directly above the CSAT survey on one page.
 *
 * So the order has to be asked rather than implied, from both sides. Every
 * predicate here is the same synchronous localStorage read the host already
 * makes, which is what makes this safe across two iframes that cannot talk:
 * they are not coordinating, they are reading the same facts and reaching the
 * same conclusion. No handshake, no race, and a suppressed load costs nothing —
 * the unplaced module stands down before it buys its property read.
 *
 * Why the unplaced notice is the one that yields: it is the only one of the
 * three that keeps. A paywall block is happening to the user right now, and a
 * CSAT trigger is fresh for hours — miss its window and the answer is gone. A
 * diagram saved on a page and placed nowhere on it is still saved and still
 * unplaced tomorrow, and its banner re-arms itself on the next load.
 *
 * A yield still has to be worth something, though. The CSAT branch originally
 * asked only whether a trigger had been ARMED, and a trigger is armed by every
 * save; whether the survey may actually SHOW is a second, per-account question
 * that CsatBanner asked for the first time on mount. For anyone who had
 * dismissed the survey in the past week the two answers disagreed, and the page
 * showed no banner at all for ten minutes after each save — this notice stood
 * down, and the survey it stood down for closed itself. Both questions are
 * asked here now (isCsatSuppressed), off the same record and the same
 * synchronous read as everything else in this cascade.
 */
export type HigherPriorityBanner = 'paywall' | 'paywall-admin' | 'csat'

export function higherPriorityBannerPending(now: number = Date.now()): HigherPriorityBanner | null {
  const identity = deriveWarningBannerIdentity()
  // Pre-Phase-5b gate first: if this user qualified as a recent author, nothing
  // about their experience changes and no flag is involved.
  if (shouldShowPaywallBanner(now, identity, false)) return 'paywall'
  // The admin verdict is a third localStorage read, still synchronous.
  if (isCurrentUserSpaceAdmin(identity) && shouldShowPaywallBanner(now, identity, true)) {
    return 'paywall-admin'
  }
  // Armed AND eligible. The trigger alone is not a reason to yield: a user who
  // dismissed the survey inside the last week has it suppressed, CsatBanner
  // would close itself on mount, and the yield would buy nothing — see
  // isCsatSuppressed for the failure this cost us.
  if (isCsatPendingFresh(now) && !isCsatSuppressed(now)) return 'csat'
  return null
}
