import { ensureDrawioViewerLoaded } from './loadDrawioViewer';

/**
 * Render a DrawIO graphXml to a standalone SVG string for the Lever D render cache
 * (Graph). Best-effort, never throws — a failed/unsupported render just returns
 * undefined and the viewer live-renders (paying the ~6s DrawIO load).
 *
 * Produced at save in the editor's parent frame, which does NOT have the DrawIO
 * viewer loaded, so we ensureDrawioViewerLoaded() first, render the graph into an
 * OFFSCREEN GraphViewer, and export via Graph.getSvg() (which bakes stencil geometry
 * inline as <path>, verified in viewer-static.min.js), falling back to the rendered
 * container SVG. Skips two cases the spike flagged as incomplete:
 *   - external <image> cells (http/https): getSvg does NOT inline these → broken cache.
 *   - multi-page mxfile: a single SVG can't represent the page-nav.
 */
export async function renderGraphToSvg(graphXml: string | undefined | null): Promise<string | undefined> {
  if (!graphXml || typeof graphXml !== 'string') return undefined;
  if (/image=https?:\/\//i.test(graphXml)) return undefined; // external image cell
  if (typeof document === 'undefined') return undefined;

  let container: HTMLElement | undefined;
  try {
    await ensureDrawioViewerLoaded();
    const w = window as unknown as { mxUtils?: any; GraphViewer?: any };
    if (!w.mxUtils || !w.GraphViewer) return undefined;

    container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(container);

    const xmlNode = w.mxUtils.parseXml(graphXml).documentElement;
    const gv = new w.GraphViewer(container, xmlNode, { 'auto-fit': false, border: 10 });
    if (gv?.diagrams && gv.diagrams.length > 1) return undefined; // multi-page

    let svgEl: SVGElement | null = null;
    if (gv?.graph && typeof gv.graph.getSvg === 'function') {
      // (background, scale, border, nocrop, crisp, ignoreSelection, showText, ...)
      svgEl = gv.graph.getSvg(null, 1, 10, false, true, true, true);
    }
    if (!svgEl) svgEl = container.querySelector('svg');
    if (!svgEl) return undefined;

    const out = svgEl.outerHTML || new XMLSerializer().serializeToString(svgEl);
    return /<svg[\s>]/i.test(out) ? out : undefined;
  } catch (e) {
    console.warn('renderGraphToSvg failed; skipping SVG cache', e);
    return undefined;
  } finally {
    container?.remove();
  }
}
