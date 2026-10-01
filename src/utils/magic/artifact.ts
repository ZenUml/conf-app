import type { MagicArtifact } from '@/model/Diagram/Diagram';

export type MagicArtifactFailure = 'missing_artifact' | 'invalid_artifact' | 'stale_source' | 'unsafe_svg';
export type MagicArtifactResult = { svg: string } | { reason: MagicArtifactFailure };

/** Hash the source as stored. Do not trim, normalize whitespace, or parse Mermaid. */
export async function magicSourceHash(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'marker', 'title', 'desc',
]);
const ATTRS = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'id', 'class',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits',
  'gradientTransform', 'clip-path', 'marker-start', 'marker-mid', 'marker-end',
  'markerUnits', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
  'role', 'aria-label', 'aria-labelledby', 'aria-hidden',
]);
const PRESENTATION = new Set([
  'fill', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'fill-opacity', 'opacity',
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor',
  'stop-color', 'stop-opacity', 'marker-start', 'marker-mid', 'marker-end',
]);
const LOCAL_URL = /^url\(#[A-Za-z_][\w.-]*\)$/;

function safeValue(value: string): boolean {
  return !/[<>;{}\\]/.test(value)
    && !/(?:javascript:|data:|https?:|@import|expression\s*\()/i.test(value)
    && (!/url\s*\(/i.test(value) || LOCAL_URL.test(value.trim()));
}

function applyDeclarations(element: Element, css: string): boolean {
  for (const declaration of css.split(';')) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator < 1) return false;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!PRESENTATION.has(property) || !safeValue(value)) return false;
    element.setAttribute(property, value);
  }
  return true;
}

/** Rebuild from an allowlist. No active elements, external loads, or event handlers. */
export function sanitizeMagicSvg(markup: string): string | null {
  if (typeof markup !== 'string' || !markup || markup.length > 1_000_000) return null;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS || doc.querySelector('parsererror')) return null;
  let unsafe = false;
  const styleRules: Array<{ selector: string; declarations: string }> = [];
  const clean = (node: Element): Element | null => {
    if (node.namespaceURI === SVG_NS && node.localName === 'style') {
      const css = (node.textContent ?? '').trim();
      const rule = /\s*([^{}]+)\{([^{}]*)\}/gy;
      let end = 0;
      while (end < css.length) {
        rule.lastIndex = end;
        const match = rule.exec(css);
        if (!match) { unsafe = true; break; }
        for (const selector of match[1].split(',')) {
          const trimmed = selector.trim();
          if (!/^(?:[a-zA-Z][\w-]*|\.[a-zA-Z_][\w-]*|#[a-zA-Z_][\w.-]*)(?:\s+(?:[a-zA-Z][\w-]*|\.[a-zA-Z_][\w-]*))*$/.test(trimmed)) unsafe = true;
          else styleRules.push({ selector: trimmed, declarations: match[2] });
        }
        end = rule.lastIndex;
      }
      return null;
    }
    if (node.namespaceURI !== SVG_NS || !ELEMENTS.has(node.localName)) {
      unsafe = true;
      return null;
    }
    const copy = document.createElementNS(SVG_NS, node.localName);
    for (const attribute of Array.from(node.attributes)) {
      const { name, value } = attribute;
      if (name.startsWith('data-')) continue;
      if (name === 'style') {
        if (!applyDeclarations(copy, value)) unsafe = true;
        continue;
      }
      // ARIA and role are inert text; XMLSerializer escapes punctuation.
      const inertText = name === 'aria-label' || name === 'aria-labelledby' || name === 'role';
      if (!ATTRS.has(name) || (attribute.namespaceURI && name !== 'xmlns')
        || (name !== 'xmlns' && !inertText && !safeValue(value))) {
        unsafe = true;
        continue;
      }
      copy.setAttribute(name, value);
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const safe = clean(child as Element);
        if (safe) copy.appendChild(safe);
      } else if (child.nodeType === Node.TEXT_NODE && ['text', 'tspan', 'title', 'desc'].includes(node.localName)) {
        copy.appendChild(document.createTextNode(child.textContent ?? ''));
      }
    }
    return copy;
  };
  const safe = clean(root);
  if (safe) {
    for (const { selector, declarations } of styleRules) {
      try {
        for (const element of Array.from(safe.querySelectorAll(selector))) {
          if (!applyDeclarations(element, declarations)) unsafe = true;
        }
      } catch { unsafe = true; }
    }
  }
  if (!safe || unsafe || !safe.querySelector('path,rect,circle,ellipse,line,polyline,polygon,text')) return null;
  return new XMLSerializer().serializeToString(safe);
}

export async function validateMagicArtifact(artifact: MagicArtifact | undefined, source: string): Promise<MagicArtifactResult> {
  if (!artifact) return { reason: 'missing_artifact' };
  if (artifact.outcome !== 'validated' || artifact.rulesVersion !== 'magic-v1'
    || !/^[a-f0-9]{64}$/.test(artifact.sourceHash) || typeof artifact.svg !== 'string') {
    return { reason: 'invalid_artifact' };
  }
  if (artifact.sourceHash !== await magicSourceHash(source)) return { reason: 'stale_source' };
  const svg = sanitizeMagicSvg(artifact.svg);
  return svg ? { svg } : { reason: 'unsafe_svg' };
}
