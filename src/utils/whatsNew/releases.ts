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
export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = [
  {
    // #734 (Connect MCP, headless MCP server). Merged to main 2026-10-10 and in
    // no release tag yet. The viewer button is gated by the agent-link Forge
    // flag, which is on only on lite-stg so far — and this banner does not read
    // that flag. Before this date passes, confirm the Lite production release
    // carries #734 AND the flag is on in production, or move the date.
    id: '2026-10-mcp-server',
    publishedAt: '2026-10-13',
    variants: ['lite'],
    headline: 'Connect your AI agent to your diagrams with MCP',
    items: [
      {
        id: 'connect-mcp',
        title: 'Connect MCP',
        body: 'Select the new Connect MCP button (the sparkles icon) on a sequence, Mermaid or PlantUML diagram, on the page or in fullscreen, to add the ZenUML MCP server to Claude Code, Codex, Cursor or another MCP client. You sign in with Atlassian once, and the agent acts as you.',
        url: 'https://zenuml.com/docs/products/zenuml-diagrams-for-confluence/mcp-server/',
      },
      {
        id: 'mcp-read-edit',
        title: 'Your agent reads and edits diagrams',
        body: 'The agent can find, read, create and update diagrams and pages without a browser tab. Each edit publishes a new version, so page history can revert it.',
      },
    ],
  },
  {
    id: '2026-10-anonymous-viewing',
    publishedAt: '2026-10-06',
    variants: ['lite', 'diagramly'],
    headline: 'Diagrams now support anonymous viewing',
    items: [
      {
        id: 'anonymous-viewing',
        title: 'View diagrams without signing in',
        body: 'Visitors can view diagrams on Confluence pages that allow anonymous access. This update does not change site, space, or page permissions.',
        url: 'https://zenuml.com/docs/products/zenuml-diagrams-for-confluence/anonymous-viewing/',
      },
    ],
  },
  {
    // #660, #664, #687 — live in Lite (v2026.10.021754-lite) and in the latest
    // Full / Diagramly tags; not in AsyncAPI's latest release, so not announced there.
    id: '2026-10',
    publishedAt: '2026-10-03',
    variants: ['lite', 'full', 'diagramly'],
    headline: 'Markdown documents, zoom on every diagram, and more room to draw',
    items: [
      {
        id: 'markdown-tab',
        title: 'Markdown tab',
        body: 'Write a Markdown document in the editor and embed Mermaid diagrams in it with fenced code blocks.',
      },
      {
        id: 'viewport-zoom',
        title: 'Zoom and pan on every diagram',
        body: 'Every diagram type now zooms the same way: use the toolbar buttons, or hold Ctrl (⌘ on Mac) and scroll.',
      },
      {
        id: 'code-panel-toggle',
        title: 'Hide the code panel',
        body: 'Collapse the code panel in the editor with one click to give your diagram the full width.',
      },
    ],
  },
]

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
