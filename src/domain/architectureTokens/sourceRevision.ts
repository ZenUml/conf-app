/**
 * Source revision facts are metadata about a Confluence-owned source body.
 * The v1 state codec stores these alongside the Mermaid body in custom content;
 * it does not need a backend source-of-truth or recovery copy.
 */

const encoder = new TextEncoder();

export interface SourceRevision {
  readonly sourceRevisionId: string;
  readonly parentSourceRevisionId?: string;
  readonly normalizedSourceSha256: string;
  readonly parserVersion: string;
  readonly validationStatus: 'valid' | 'invalid' | 'unsupported';
}

/** Only normalize transport artifacts; all Mermaid semantics stay intact. */
export function normalizeSourceForHash(source: string): string {
  const withoutBom = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return withoutBom.replace(/\r\n?/g, '\n');
}

export async function sha256NormalizedSource(source: string): Promise<string> {
  const bytes = encoder.encode(normalizeSourceForHash(source));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
