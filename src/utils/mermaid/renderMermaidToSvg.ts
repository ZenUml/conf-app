import { loadMermaid } from './loadMermaid';

/**
 * Render Mermaid DSL to an SVG string for the Lever D save-time render cache.
 *
 * Reuses the loadMermaid() singleton (already warm in the editor where save
 * happens), so the marginal cost at save is just mermaid.render(). Returns
 * `undefined` on ANY failure — the cache is strictly best-effort and must never
 * block or fail a save; the viewer live-renders when the cached SVG is absent.
 *
 * The produced SVG is OUR OWN trusted output. It is still sanitized on READ
 * (utils/mermaid/sanitizeSvg) before injection, because a stored SVG could be
 * tampered via a direct write:custom-content REST PUT that bypasses this path.
 */
export async function renderMermaidToSvg(code: string): Promise<string | undefined> {
  if (!code) return undefined;
  const renderId = `mermaid-cache-${crypto.randomUUID()}`;
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(renderId, code);
    return svg;
  } catch (error) {
    // mermaid leaves a temp element (`d${renderId}`) behind on a render throw —
    // clean it up so repeated save failures don't leak DOM nodes (mirrors
    // Mermaid.vue's render() error path).
    if (typeof document !== 'undefined') {
      document.getElementById(`d${renderId}`)?.remove();
    }
    console.warn('renderMermaidToSvg failed; skipping SVG cache', error);
    return undefined;
  }
}
