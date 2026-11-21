// Turn Confluence footer-comment payloads into the threads the panel shows (#1047).
import { splitCommentBody, type CommentMarker } from './commentLink';

/** The parts of a Confluence v2 footer comment this feature reads. */
export interface RawComment {
  id: string;
  body?: { atlas_doc_format?: { value?: string } };
  version?: { authorId?: string; createdAt?: string; number?: number };
}

export interface DiagramComment {
  id: string;
  authorId?: string;
  createdAt?: string;
  text: string;
  /** Diagram version when the comment was written, from the link's `dv`. */
  diagramVersion?: number;
  marker: CommentMarker | null;
}

export interface DiagramThread {
  root: DiagramComment;
  replies: DiagramComment[];
}

function adfOf(raw: RawComment): unknown | null {
  const value = raw.body?.atlas_doc_format?.value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function toDiagramComment(raw: RawComment): DiagramComment | null {
  const adf = adfOf(raw);
  if (!adf) return null;
  const { text, marker } = splitCommentBody(adf);
  return {
    id: String(raw.id),
    ...(raw.version?.authorId ? { authorId: raw.version.authorId } : {}),
    ...(raw.version?.createdAt ? { createdAt: raw.version.createdAt } : {}),
    text,
    ...(marker?.diagramVersion !== undefined ? { diagramVersion: marker.diagramVersion } : {}),
    marker,
  };
}

const time = (c: DiagramComment) => (c.createdAt ? Date.parse(c.createdAt) || 0 : 0);

/**
 * The page's top-level comments that point at this diagram, newest first.
 * A page comment nobody linked to a diagram is not part of any diagram's thread.
 */
export function rootsForDiagram(raws: RawComment[], diagramId: string): DiagramComment[] {
  return raws
    .map(toDiagramComment)
    .filter((c): c is DiagramComment => c !== null && c.marker?.diagramId === diagramId)
    .sort((a, b) => time(b) - time(a));
}

/** Replies carry no link; they belong to a thread by Confluence's parent relation. */
export function repliesOldestFirst(raws: RawComment[]): DiagramComment[] {
  return raws
    .map(toDiagramComment)
    .filter((c): c is DiagramComment => c !== null)
    .sort((a, b) => time(a) - time(b));
}

/** The root comment we just posted, found by its nonce, so an uncertain save is never repeated. */
export function findPostedByNonce(raws: RawComment[], nonce: string): RawComment | undefined {
  return raws.find(raw => toDiagramComment(raw)?.marker?.nonce === nonce);
}
