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
// These inert identifiers let the existing relationship highlighter bind a
// prepared SVG to the independently parsed Mermaid source. All other producer
// metadata is discarded. Never treat their mere presence as a valid binding.
const SEMANTIC_DATA = new Set(['data-node', 'data-node-id', 'data-group', 'data-edge', 'data-edge-id', 'data-source', 'data-target']);

function safeValue(value: string): boolean {
  return !/[<>;{}\\]/.test(value)
    && !/(?:javascript:|data:|https?:|@import|!important|var\s*\(|expression\s*\()/i.test(value)
    && (!/url\s*\(/i.test(value) || LOCAL_URL.test(value.trim()));
}

type CssPriority = readonly [inline: number, ids: number, classes: number, elements: number];
const INLINE_PRIORITY: CssPriority = [1, 0, 0, 0];
const RULE_PRIORITY: CssPriority = [0, 0, 0, 0];

function comparePriority(left: CssPriority, right: CssPriority): number {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function applyDeclarations(element: Element, css: string, priority: CssPriority,
  priorities: WeakMap<Element, Map<string, CssPriority>>): boolean {
  for (const declaration of css.split(';')) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator < 1) return false;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!PRESENTATION.has(property) || !safeValue(value)) return false;
    let elementPriorities = priorities.get(element);
    if (!elementPriorities) {
      elementPriorities = new Map();
      priorities.set(element, elementPriorities);
    }
    // Presentation attributes have lower priority than any stylesheet rule.
    // CSS specificity is lexicographic, not a 100/10/1 sum; source order wins
    // exact ties, and inline style outranks all supported selectors.
    const previous = elementPriorities.get(property);
    if (!previous || comparePriority(previous, priority) <= 0) {
      element.setAttribute(property, value);
      elementPriorities.set(property, priority);
    }
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
  const priorities = new WeakMap<Element, Map<string, CssPriority>>();
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
    let inlineStyle: string | null = null;
    for (const attribute of Array.from(node.attributes)) {
      const { name, value } = attribute;
      // createElementNS + XMLSerializer emits this automatically; copying the
      // declaration would produce a duplicate xmlns and invalid XML.
      if (name === 'xmlns') continue;
      if (name.startsWith('data-')) {
        if (!SEMANTIC_DATA.has(name)) continue;
        // Older Pi output uses empty data-group on ungrouped nodes. That is a
        // harmless absence, not a group binding; do not retain it.
        if (name === 'data-group' && !value) continue;
        if (!value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) {
          unsafe = true;
          continue;
        }
        const canonical = name === 'data-node-id' ? 'data-node' : name === 'data-edge-id' ? 'data-edge' : name;
        if (copy.hasAttribute(canonical)) { unsafe = true; continue; }
        copy.setAttribute(canonical, value);
        continue;
      }
      if (name === 'style') {
        inlineStyle = value;
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
    if (inlineStyle !== null && !applyDeclarations(copy, inlineStyle, INLINE_PRIORITY, priorities)) unsafe = true;
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
        // Reject an unsafe declaration even if its selector matches nothing.
        if (!applyDeclarations(document.createElementNS(SVG_NS, 'g'), declarations, RULE_PRIORITY, priorities)) {
          unsafe = true;
          continue;
        }
        // The supported selector grammar has only type, class, ID, and
        // descendant tokens. Specificity is [ID, class, element], compared
        // lexicographically. Include root, which querySelectorAll omits.
        const specificity = selector.split(/\s+/).reduce<CssPriority>((score, token) => [
          0,
          score[1] + Number(token.startsWith('#')),
          score[2] + Number(token.startsWith('.')),
          score[3] + Number(!token.startsWith('#') && !token.startsWith('.')),
        ], RULE_PRIORITY);
        const matches = [...(safe.matches(selector) ? [safe] : []), ...Array.from(safe.querySelectorAll(selector))];
        for (const element of matches) {
          if (!applyDeclarations(element, declarations, specificity, priorities)) unsafe = true;
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
