/**
 * Sanitize a stored SVG before injecting it into the viewer (Lever D cached path).
 *
 * Why this exists: the live mermaid path is safe because mermaid
 * (securityLevel:'strict') runs its OWN DOMPurify pass at render. The Lever D cached
 * path skips mermaid.render() and v-htmls a STORED svg from the custom-content body,
 * which could be tampered via a direct `write:custom-content` REST PUT that bypasses
 * our save path → stored XSS in the viewer iframe. We re-sanitize on read.
 *
 * Why a scrub, not DOMPurify: DOMPurify's SVG handling strips mermaid's
 * <foreignObject> HTML labels (verified across 3 configs — foreignObject children
 * are parsed in the SVG namespace where div/span are invalid), destroying render
 * fidelity. The design doc's sanctioned fallback is a targeted scrub. We parse with
 * DOMParser (identical in the Forge iframe and jsdom), KEEP all structure, and remove
 * only the active-content vectors: <script> elements, on* event-handler attributes,
 * and javascript:/data: (non-image) URIs in href/xlink:href. Legit cached SVGs are
 * already mermaid-DOMPurify-clean, so this is a no-op on real content and only
 * neutralizes tampered markup; it lands inside a Forge-sandboxed (CSP) iframe as
 * defense in depth. Returns undefined on empty/garbage/parse-error/non-svg input —
 * the caller then live-renders (the fallback is always safe).
 */
export function sanitizeSvg(svg: string | undefined | null): string | undefined {
  if (!svg || typeof svg !== 'string') return undefined;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return undefined;
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return undefined;
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return undefined;

    const toRemove: Element[] = [];
    const scrub = (el: Element) => {
      if (el.tagName.toLowerCase() === 'script') {
        toRemove.push(el);
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (
          (name === 'href' || name === 'xlink:href' || name.endsWith(':href')) &&
          /^\s*(javascript|data):/i.test(attr.value) &&
          !/^\s*data:image\//i.test(attr.value)
        ) {
          el.removeAttribute(attr.name);
        }
      }
    };

    scrub(root);
    root.querySelectorAll('*').forEach(scrub);
    toRemove.forEach((el) => el.remove());

    const out = new XMLSerializer().serializeToString(root);
    return /<svg[\s>]/i.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}
