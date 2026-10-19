// Shared by the browser, Forge export function, and Cloudflare upload worker.
// The caller supplies its own authenticated Confluence requester.
export const PNG_STATE_SCHEMA = 1;
const IN_PROGRESS_TTL_MS = 10 * 60 * 1000;
const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;
const STATES = new Set(['generating', 'waiting_for_publish', 'generation_failed', 'upload_denied', 'upload_failed', 'ready', 'missing']);

export function pngStateKey(customContentId) {
  return `zenuml-png-export-${customContentId}`;
}

function path(pageId) {
  return `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/properties`;
}

function valid(value, pageId, customContentId, now = Date.now()) {
  if (!value || value.schemaVersion !== PNG_STATE_SCHEMA || value.pageId !== String(pageId)
    || value.customContentId !== String(customContentId) || !STATES.has(value.state)
    || typeof value.attemptId !== 'string' || !value.attemptId
    || !Number.isFinite(value.startedAt) || !Number.isFinite(value.updatedAt)
    || value.startedAt > value.updatedAt || value.updatedAt > now + 60_000) return false;
  return true;
}

function fresh(value, now) {
  const ttl = value.state === 'generating' || value.state === 'waiting_for_publish'
    ? IN_PROGRESS_TTL_MS : TERMINAL_TTL_MS;
  return now - value.updatedAt <= ttl;
}

async function bounded(operation, deadline) {
  const remaining = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (remaining <= 0) throw new Error('property_timeout');
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('property_timeout')), remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** A 200 with results:[] is absent; any failed GET remains unknown. */
export async function readPngState(request, pageId, customContentId, onFailure = () => {}, now = Date.now(), deadline = Date.now() + REQUEST_TIMEOUT_MS) {
  try {
    const key = pngStateKey(customContentId);
    const response = await bounded(() => request(`${path(pageId)}?key=${encodeURIComponent(key)}`, 'GET'), deadline);
    if (!response.ok) throw new Error(`read_http_${response.status}`);
    const item = (await bounded(() => response.json(), deadline))?.results?.[0];
    if (!item) return { kind: 'absent' };
    if (!item.id || !Number.isInteger(item.version?.number)) return { kind: 'error' };
    const record = { value: item.value, id: String(item.id), version: item.version.number };
    if (!valid(item.value, pageId, customContentId, now)) return { kind: 'invalid', ...record };
    return { kind: fresh(item.value, now) ? 'ok' : 'stale', ...record };
  } catch (error) {
    onFailure('read', error);
    return { kind: 'error' };
  }
}

/**
 * Start accepts only an attempt at least as new as the stored attempt.
 * Terminal updates require the same attempt ID. Conflicts cause one fresh read
 * and decision, never a blind overwrite of a newer result.
 */
export async function writePngState(request, input, onFailure = () => {}, now = Date.now()) {
  const { pageId, customContentId, state, attemptId, startedAt, contentHash, attachmentId, expectedVersion } = input;
  if (!pageId || !customContentId || !STATES.has(state) || !attemptId) return false;
  const isStart = input.startAttempt === true;
  if (isStart && !['generating', 'waiting_for_publish', 'missing'].includes(state)) return false;
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const key = pngStateKey(customContentId);
  const value = {
    schemaVersion: PNG_STATE_SCHEMA, pageId: String(pageId), customContentId: String(customContentId),
    state, attemptId, startedAt, updatedAt: now,
    ...(contentHash ? { contentHash } : {}), ...(attachmentId ? { attachmentId } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await readPngState(request, pageId, customContentId, onFailure, now, deadline);
    if (current.kind === 'error') return false;
    if (state === 'missing' && expectedVersion !== undefined) {
      if (expectedVersion === null ? current.kind !== 'absent'
        : current.kind === 'absent' || current.version !== expectedVersion) return false;
    }
    if (current.kind === 'ok' || current.kind === 'stale') {
      if (isStart && current.kind === 'ok' && current.value.attemptId !== attemptId
        && current.value.startedAt >= startedAt) return false;
      if (!isStart && current.value.attemptId !== attemptId) return false;
      if (current.kind === 'ok' && current.value.attemptId === attemptId
        && current.value.state === state && current.value.contentHash === contentHash
        && current.value.attachmentId === attachmentId) return false;
      // A late failure for the same attempt cannot downgrade ready.
      if (current.value.state === 'ready' && !isStart) return false;
      if (!isStart) value.startedAt = current.value.startedAt;
    } else if (!isStart && state !== 'missing') {
      // A terminal result with no matching start cannot claim this page.
      return false;
    }
    const existing = current.kind !== 'absent';
    const method = existing ? 'PUT' : 'POST';
    const url = existing ? `${path(pageId)}/${encodeURIComponent(current.id)}` : path(pageId);
    const body = existing
      ? { key, value, version: { number: current.version + 1 } }
      : { key, value };
    try {
      const response = await bounded(() => request(url, method, body), deadline);
      if (response.ok) return true;
      if (response.status === 409 && attempt === 0 && state !== 'missing') continue;
      throw new Error(`${method.toLowerCase()}_http_${response.status}`);
    } catch (error) {
      onFailure(method === 'PUT' ? 'update' : 'create', error);
      return false;
    }
  }
  return false;
}
