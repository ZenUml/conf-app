// The attempt chain for render_diagram, held by the agent rather than by us.
//
// Each result carries a `revision` token; an agent that passes it back on its
// next call lets the server tell a retry from a new diagram: which attempt
// this is, whether the previous result's rewrite was applied, and whether the
// same mistake came back. The server stores nothing, so the endpoint's
// "saves nothing" promise holds and no session store is needed.
//
// The token is not signed. It grants nothing: a forged or edited token can
// only change the attempt number and hint wording the sender gets back, and
// the analytics of its own calls. No source text goes in it, only a hash.

import type { ZenumlIssueCode } from './zenumlDslGuide';

/** Mirrors AgentLinkRenderIssue in src/utils/analytics/catalog.ts. */
export type RenderIssue = ZenumlIssueCode | 'unrecognised';

export interface RevisionState {
  /** Attempt number of the result that issued this token (1-based). */
  n: number;
  /** hashSource of that call's source. */
  h: string;
  /** Issue codes that result reported. */
  c: RenderIssue[];
  /** hashSource of the suggested rewrite it returned, if any. */
  f?: string;
}

export type RevisionDecode =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'valid'; state: RevisionState };

export const MAX_REVISION_CHARS = 512;
const PREFIX = 'r1.';
const MAX_ATTEMPT = 1000;
const HASH = /^[0-9a-f]{16}$/;
const ISSUES: ReadonlySet<string> = new Set<RenderIssue>([
  'group_with_messages',
  'block_in_async_message',
  'group_after_message',
  'block_after_async_message',
  'unrecognised',
]);

/** First 16 hex characters of the SHA-256 of the source. */
export async function hashSource(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function encodeRevision(state: RevisionState): string {
  // The JSON is ASCII (numbers, hex and fixed codes), so btoa is safe.
  const b64 = btoa(JSON.stringify(state)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${PREFIX}${b64}`;
}

/** Never throws: anything unreadable is 'invalid' and counts as a first attempt. */
export function decodeRevision(token: unknown): RevisionDecode {
  if (token === undefined || token === null || token === '') return { status: 'none' };
  if (typeof token !== 'string' || token.length > MAX_REVISION_CHARS || !token.startsWith(PREFIX)) {
    return { status: 'invalid' };
  }
  try {
    const b64 = token.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(b64)) as Partial<RevisionState>;
    const { n, h, c, f } = raw;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_ATTEMPT) return { status: 'invalid' };
    if (typeof h !== 'string' || !HASH.test(h)) return { status: 'invalid' };
    if (!Array.isArray(c) || c.length > ISSUES.size || !c.every((x) => typeof x === 'string' && ISSUES.has(x))) {
      return { status: 'invalid' };
    }
    if (f !== undefined && (typeof f !== 'string' || !HASH.test(f))) return { status: 'invalid' };
    return { status: 'valid', state: { n: n as number, h, c, ...(f ? { f } : {}) } };
  } catch {
    return { status: 'invalid' };
  }
}
