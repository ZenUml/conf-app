/**
 * Render ZenUML sequence DSL to an SVG string for the Lever D save-time render cache.
 *
 * Uses @zenuml/core's synchronous renderToSvg() (v3.47.5+). At save the bundle is
 * already warm — the editor loaded it to render the live diagram — so the dynamic
 * import resolves from cache and the marginal cost is just the render itself.
 *
 * Returns `undefined` on ANY failure (missing export on an older core, a parse
 * throw, empty result): the cache is strictly best-effort and must never block or
 * fail a save; the viewer falls back to the at-view sync_svg render, then to the
 * interactive React render.
 *
 * renderToSvg IGNORES the theme option in v3.47.5, so this is always the
 * default-theme render — the viewer must only inject it under the same default-theme
 * gate (Sequence.canUseSyncSvg). The produced SVG is OUR OWN trusted output but is
 * still sanitized on READ (utils/mermaid/sanitizeSvg) before injection, because a
 * stored SVG could be tampered via a direct write:custom-content REST PUT.
 */
export async function renderSequenceToSvg(code: string): Promise<string | undefined> {
  if (!code) return undefined;
  try {
    const mod = await import('@zenuml/core');
    if (typeof mod.renderToSvg !== 'function') return undefined;
    const result = mod.renderToSvg(code);
    const svg = result && result.svg;
    return svg || undefined;
  } catch (error) {
    console.warn('renderSequenceToSvg failed; skipping SVG cache', error);
    return undefined;
  }
}
