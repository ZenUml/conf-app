// Reads Confluence AS THE VIEWER with the Forge user token (#921). The token is
// the viewer's own, so this never widens what they can read; the checks below
// keep a malformed request from fetching, or mirroring, a record other than
// the one that was asked for.

const CONTENT_ID = /^\d{1,30}$/;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Confluence content ids are decimal digits. Anything else never reaches a URL path. */
export function isContentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID.test(value);
}

// Fixed codes only: no upstream body, URL or token, so callers can return them
// to the client as they are.
export type ReadAsUserFailure =
  | 'invalid_content_id'
  | 'timeout'
  | 'network_error'
  | 'oversize'
  | 'invalid_json'
  | 'id_mismatch'
  | `http_${number}`;

export type ReadAsUserResult =
  | { ok: true; content: any }
  | { ok: false; reason: ReadAsUserFailure };

export async function readCustomContentAsUser(
  apiBaseUrl: string,
  contentId: string,
  userToken: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES }: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<ReadAsUserResult> {
  if (!isContentId(contentId)) return { ok: false, reason: 'invalid_content_id' };

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/api/v2/custom-content/${contentId}?body-format=raw`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${userToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, reason: (e as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, reason: 'oversize' };
  let content: any;
  try {
    content = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (String(content?.id) !== contentId) return { ok: false, reason: 'id_mismatch' };
  return { ok: true, content };
}
