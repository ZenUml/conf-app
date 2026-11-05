// The link a diagram comment carries back to its diagram (#1047).
//
// A diagram comment is a Confluence PAGE footer comment, so Confluence itself
// does not know which diagram it is about. The link in the comment says so:
//
//   <page url>?zenumlDiagram=<customContentId>&zenumlLocal=<macro localId>&dv=<diagram version>&zn=<nonce>
//
// - zenumlDiagram  which diagram the comment belongs to; the panel filters on it.
// - zenumlLocal    which embed of that diagram to scroll to (unique per macro instance).
// - dv             the diagram version when the comment was written ("posted on v3").
// - zn             a per-comment nonce, so a second comment link to the same macro still reveals.
//
// Nothing here is sent to analytics: a link carries ids from the customer's own Confluence.

export interface CommentMarker {
  diagramId: string;
  localId?: string;
  diagramVersion?: number;
  nonce?: string;
}

const P_DIAGRAM = 'zenumlDiagram';
const P_LOCAL = 'zenumlLocal';
const P_VERSION = 'dv';
const P_NONCE = 'zn';

/** Canonical page url plus the marker. Any other query string and the hash are dropped. */
export function buildCommentLink(pageUrl: string, marker: CommentMarker): string {
  const url = new URL(pageUrl);
  const out = new URL(url.origin + url.pathname);
  out.searchParams.set(P_DIAGRAM, marker.diagramId);
  if (marker.localId) out.searchParams.set(P_LOCAL, marker.localId);
  if (marker.diagramVersion !== undefined) out.searchParams.set(P_VERSION, String(marker.diagramVersion));
  if (marker.nonce) out.searchParams.set(P_NONCE, marker.nonce);
  return out.toString();
}

/** The marker in a link, or null when the link is not a diagram-comment link. */
export function parseCommentLink(href: string): CommentMarker | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const diagramId = url.searchParams.get(P_DIAGRAM);
  if (!diagramId) return null;
  const marker: CommentMarker = { diagramId };
  const localId = url.searchParams.get(P_LOCAL);
  if (localId) marker.localId = localId;
  const version = url.searchParams.get(P_VERSION);
  if (version !== null && /^\d+$/.test(version)) marker.diagramVersion = Number(version);
  const nonce = url.searchParams.get(P_NONCE);
  if (nonce) marker.nonce = nonce;
  return marker;
}

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: AdfNode[];
}

const isNode = (v: unknown): v is AdfNode => typeof v === 'object' && v !== null;

/** Every link target in a node: link marks and inline cards. */
function hrefsOf(node: AdfNode): string[] {
  const found: string[] = [];
  const visit = (n: AdfNode) => {
    if (n.type === 'inlineCard' && typeof n.attrs?.url === 'string') found.push(n.attrs.url);
    for (const m of n.marks ?? []) {
      if (m.type === 'link' && typeof m.attrs?.href === 'string') found.push(m.attrs.href);
    }
    for (const c of n.content ?? []) if (isNode(c)) visit(c);
  };
  visit(node);
  return found;
}

function markerOfNode(node: AdfNode): CommentMarker | null {
  for (const href of hrefsOf(node)) {
    const marker = parseCommentLink(href);
    if (marker) return marker;
  }
  return null;
}

/** The first marker found anywhere in an ADF document. */
export function markerFromAdf(adf: unknown): CommentMarker | null {
  return isNode(adf) ? markerOfNode(adf) : null;
}

function plainText(node: AdfNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return typeof node.attrs?.text === 'string' ? node.attrs.text : '@user';
  if (node.type === 'inlineCard') return typeof node.attrs?.url === 'string' ? node.attrs.url : '';
  return (node.content ?? []).filter(isNode).map(plainText).join('');
}

/**
 * What the reader wrote, and the marker. The paragraph that carries the marker
 * link is the "back to the diagram" line this feature adds, so it is left out of
 * the text.
 */
export function splitCommentBody(adf: unknown): { text: string; marker: CommentMarker | null } {
  if (!isNode(adf)) return { text: '', marker: null };
  const marker = markerOfNode(adf);
  const blocks = (adf.content ?? []).filter(isNode);
  const written = blocks.filter(block => !markerOfNode(block));
  const text = written
    .map(plainText)
    .map(s => s.replace(/[ \t]+\n/g, '\n').trim())
    .filter(s => s !== '')
    .join('\n');
  return { text, marker };
}
