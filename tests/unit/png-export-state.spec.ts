import { describe, expect, it, vi } from 'vitest';
import { pngStateKey, readPngState, writePngState } from '../../src/lib/pngExportState.js';

const now = Date.parse('2026-10-19T00:00:00Z');
const input = (pageId = '1', customContentId = '10', attemptId = 'attempt-a', state = 'generating') => ({
  pageId, customContentId, attemptId, state, startedAt: now, contentHash: 'hash-a',
  startAttempt: state === 'generating',
});

function store() {
  const records = new Map<string, { id: string; value: any; version: { number: number } }>();
  let nextId = 1;
  const request = vi.fn(async (url: string, method: string, body?: any) => {
    const key = method === 'GET' ? new URL(url, 'https://example.atlassian.net').searchParams.get('key')!
      : method === 'POST' ? body.key : [...records.keys()].find(k => records.get(k)?.id === url.split('/').at(-1))!;
    const current = records.get(key);
    if (method === 'GET') return new Response(JSON.stringify({ results: current ? [current] : [] }), { status: 200 });
    if (method === 'POST') {
      if (current) return new Response('', { status: 409 });
      records.set(key, { id: String(nextId++), value: body.value, version: { number: 1 } });
      return new Response('{}', { status: 200 });
    }
    if (!current || body.version.number !== current.version.number + 1) return new Response('', { status: 409 });
    records.set(key, { ...current, value: body.value, version: { number: body.version.number } });
    return new Response('{}', { status: 200 });
  });
  return { records, request };
}

describe('PNG export page state', () => {
  it('isolates custom content on the same page and rejects malformed identities', async () => {
    const { records, request } = store();
    expect(await writePngState(request, input(), undefined, now)).toBe(true);
    expect((await readPngState(request, '1', '10', undefined, now)).kind).toBe('ok');
    expect((await readPngState(request, '1', '11', undefined, now)).kind).toBe('absent');
    records.get(pngStateKey('10'))!.value.pageId = '2';
    expect((await readPngState(request, '1', '10', undefined, now)).kind).toBe('invalid');
  });

  it('replaces expired and malformed records using the stored version', async () => {
    const { records, request } = store();
    await writePngState(request, input(), undefined, now);
    const later = now + 25 * 60 * 60 * 1000;
    expect((await readPngState(request, '1', '10', undefined, later)).kind).toBe('stale');
    expect(await writePngState(request, { ...input('1', '10', 'attempt-b'), startedAt: later }, undefined, later)).toBe(true);
    expect(records.get(pngStateKey('10'))?.version.number).toBe(2);
    records.get(pngStateKey('10'))!.value = { bogus: true };
    expect(await writePngState(request, { ...input('1', '10', 'attempt-c'), startedAt: later + 1 }, undefined, later + 1)).toBe(true);
    expect(records.get(pngStateKey('10'))?.version.number).toBe(3);
  });

  it('does not let an older delayed start replace a newer expired record', async () => {
    const { request } = store();
    await writePngState(request, { ...input(), startedAt: now + 1000 }, undefined, now + 1000);
    const expired = now + 25 * 60 * 60 * 1000;
    expect((await readPngState(request, '1', '10', undefined, expired)).kind).toBe('stale');
    expect(await writePngState(request, { ...input('1', '10', 'older-attempt'), startedAt: now }, undefined, expired)).toBe(false);
  });

  it('blocks old terminal results and a stale export missing write racing a new upload', async () => {
    const { request } = store();
    await writePngState(request, input(), undefined, now);
    const old = await readPngState(request, '1', '10', undefined, now);
    await writePngState(request, { ...input('1', '10', 'attempt-b'), startedAt: now + 1 }, undefined, now + 1);
    expect(await writePngState(request, { ...input('1', '10', 'attempt-a', 'upload_failed') }, undefined, now + 2)).toBe(false);
    expect(await writePngState(request, {
      ...input('1', '10', 'export-attempt', 'missing'), startedAt: now + 2, startAttempt: true, expectedVersion: old.version,
    }, undefined, now + 2)).toBe(false);
    expect((await readPngState(request, '1', '10', undefined, now + 2)).value.state).toBe('generating');
  });

  it('treats same-millisecond attempts as a tie and never downgrades ready', async () => {
    const { request } = store();
    await writePngState(request, input(), undefined, now);
    expect(await writePngState(request, input('1', '10', 'attempt-b'), undefined, now)).toBe(false);
    await writePngState(request, input('1', '10', 'attempt-a', 'ready'), undefined, now + 1);
    expect(await writePngState(request, input('1', '10', 'attempt-a', 'upload_failed'), undefined, now + 2)).toBe(false);
    expect((await readPngState(request, '1', '10', undefined, now + 2)).value.state).toBe('ready');
  });

  it('rejects an old async waiting-for-publish result after a newer ready attempt', async () => {
    const { request } = store();
    await writePngState(request, input(), undefined, now);
    await writePngState(request, { ...input('1', '10', 'attempt-b'), startedAt: now + 1 }, undefined, now + 1);
    await writePngState(request, { ...input('1', '10', 'attempt-b', 'ready'), startedAt: now + 1 }, undefined, now + 2);
    expect(await writePngState(request, { ...input('1', '10', 'attempt-a', 'waiting_for_publish'), startedAt: now + 3 }, undefined, now + 3)).toBe(false);
    expect((await readPngState(request, '1', '10', undefined, now + 3)).value.state).toBe('ready');
  });

  it('leaves an unreadable property unknown and never writes blindly', async () => {
    const request = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    const failures = vi.fn();
    expect((await readPngState(request, '1', '10', failures, now)).kind).toBe('error');
    expect(await writePngState(request, input(), failures, now)).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(failures).toHaveBeenCalledWith('read', expect.any(Error));
  });

  it('re-reads a 409 and applies a terminal update only to the same attempt', async () => {
    const { request } = store();
    await writePngState(request, input(), undefined, now);
    let conflict = true;
    const conflicted = vi.fn(async (url: string, method: string, body?: any) => {
      if (method === 'PUT' && conflict) {
        conflict = false;
        return new Response('', { status: 409 });
      }
      return request(url, method, body);
    });
    expect(await writePngState(conflicted, input('1', '10', 'attempt-a', 'ready'), undefined, now + 1)).toBe(true);
    expect(conflicted.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(2);
    expect((await readPngState(request, '1', '10', undefined, now + 1)).value.state).toBe('ready');
  });

  it('bounds an unresponsive property read and does not issue a write', async () => {
    const request = vi.fn(() => new Promise<Response>(() => {}));
    const failures = vi.fn();
    const start = Date.now();
    expect(await writePngState(request, input(), failures, now)).toBe(false);
    expect(Date.now() - start).toBeLessThan(2200);
    expect(request).toHaveBeenCalledTimes(1);
    expect(failures).toHaveBeenCalledWith('read', expect.any(Error));
  });
});
