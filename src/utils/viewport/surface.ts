import type { Surface } from '@/utils/analytics/catalog';

/**
 * Which of the three diagram surfaces the viewport is on, as the analytics
 * `surface` property spells it.
 *
 * The three are genuinely different hosts, not skins: fullscreen is a modal with
 * an explicit height, the editor preview is a fixed-height pane, and the page
 * viewer is a Forge macro iframe sized by its own content. Every viewport rule
 * that differs between surfaces — the 0.875 breathing room, whether the box
 * takes the diagram's height, whether a plain wheel has anywhere to go — turns
 * on this distinction, so it is worth one definition rather than a copy per
 * component.
 */
export function viewportSurface(isDisplayMode: boolean): Surface {
  if (isFullscreenViewport()) return 'fullscreen';
  return isDisplayMode ? 'viewer' : 'editor';
}

/** Fullscreen is a Forge modal, which announces itself on the macro context. */
export function isFullscreenViewport(): boolean {
  return (window as { forgeGlobal?: { forgeContext?: { extension?: { modal?: { macroMode?: string } } } } })
    .forgeGlobal?.forgeContext?.extension?.modal?.macroMode === 'fullscreen';
}

/**
 * Whether an ungated wheel on this surface has somewhere to go.
 *
 * Only the page viewer does: its Forge iframe is sized to the diagram, so
 * nothing inside the frame can absorb the wheel and it chains out to the
 * Confluence page and scrolls it — which is what the reader wanted. Fullscreen
 * and the editor preview are fixed-height hosts with no page behind the diagram
 * to take it, so a wheel without the zoom modifier there does nothing at all,
 * and that is the one place a hint is worth showing.
 *
 * Note the discriminator is the host, NOT `overflow: hidden` on the viewport:
 * `.diagram-viewport--interactive` sets that on all three surfaces (it is off
 * only for the Export PNG host), so it separates nothing.
 *
 * Not yet confirmed in a browser for the editor preview — if the Confluence
 * editor behind it turns out to scroll, the wheel there did do something and the
 * hint on that surface is noise. Verify before treating the editor half of this
 * rule as settled.
 */
export function wheelFallsThroughToPage(isDisplayMode: boolean): boolean {
  return viewportSurface(isDisplayMode) === 'viewer';
}
