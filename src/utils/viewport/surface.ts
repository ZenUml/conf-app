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
 * Whether a plain wheel (no Ctrl/Cmd) on this surface belongs to the page.
 *
 * Only on the page viewer: its Forge iframe is sized to the diagram, so
 * nothing inside the frame can absorb the wheel and it chains out to the
 * Confluence page and scrolls it — which is what the reader wanted. Fullscreen
 * and the editor preview are fixed-height hosts with no page behind the diagram
 * to take it, so there a plain wheel zooms the diagram (see `classifyWheel`).
 *
 * Note the discriminator is the host, NOT `overflow: hidden` on the viewport:
 * `.diagram-viewport--interactive` sets that on all three surfaces (it is off
 * only for the Export PNG host), so it separates nothing.
 *
 * The editor preview is a fixed-height pane beside the source. Whether the
 * editor around it would scroll on a wheel was never confirmed in a browser;
 * if it does, that scroll is what a plain wheel over the preview now gives up.
 */
export function wheelFallsThroughToPage(isDisplayMode: boolean): boolean {
  return viewportSurface(isDisplayMode) === 'viewer';
}
