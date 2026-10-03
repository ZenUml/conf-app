import type { ProductType } from '@/utils/analytics/productType'

/**
 * Release notes shown by the "What's new" page banner
 * (src/components/WhatsNew/WhatsNewBanner.vue).
 *
 * Adding an entry is the whole release process: the banner picks the newest
 * entry whose display window contains `now`, so a release can be merged ahead
 * of time with a future `publishedAt` and goes live on its own. An empty list
 * means the banner never shows.
 *
 * Copy rules — the page-banner module guidelines are Atlassian's, not ours:
 *   - Informational only. Banners "must not be used to upsell or cross-promote
 *     apps", so no "upgrade to Full" items, no pricing, no other products.
 *   - No tenant names, page titles or other customer data (client-privacy
 *     policy): this file ships in the public bundle.
 *   - `id`s are analytics keys (`whats_new_release_id`, `whats_new_item_id`).
 *     Never reuse one for different content.
 */
export interface WhatsNewItem {
  /** Stable within its release; reported as `whats_new_item_id`. */
  id: string
  title: string
  /** One or two sentences. Plain text. */
  body: string
  /** Optional "Learn more" target. Opened via the Forge router, never a raw anchor. */
  url?: string
}

export interface WhatsNewRelease {
  /** Stable id, e.g. '2026-10'. Reported as `whats_new_release_id`. */
  id: string
  /** ISO date the release starts showing. */
  publishedAt: string
  /** The collapsed strip's one-line summary. */
  headline: string
  items: WhatsNewItem[]
  /** Variants that ship this release. Omitted means all four. */
  variants?: ProductType[]
}

/** How long after `publishedAt` a release keeps showing. Stale news is not news. */
export const WHATS_NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Newest first. */
export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = []

/**
 * The release this load should announce, or null. Newest live entry wins, so
 * publishing a second release inside the first one's window supersedes it
 * rather than queuing behind it.
 */
export function currentRelease(
  productType: ProductType,
  now: number = Date.now(),
  releases: readonly WhatsNewRelease[] = WHATS_NEW_RELEASES,
): WhatsNewRelease | null {
  let best: WhatsNewRelease | null = null
  let bestStart = -Infinity
  for (const release of releases) {
    if (release.variants && !release.variants.includes(productType)) continue
    if (release.items.length === 0) continue
    const start = Date.parse(release.publishedAt)
    if (!Number.isFinite(start)) continue
    if (now < start || now >= start + WHATS_NEW_WINDOW_MS) continue
    if (start > bestStart) {
      best = release
      bestStart = start
    }
  }
  return best
}
