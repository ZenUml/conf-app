import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestConfluenceJson } from '@/utils/byline/confluenceRequest';
import { viewerAccountKind } from './viewerAccount';

vi.mock('@/utils/byline/confluenceRequest', () => ({ requestConfluenceJson: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const clientDomain = 'example-tenant';
const accountId = '557058:viewer-a';
const KEY = `zenuml.viewerKind.v1:${clientDomain}:${accountId}`;
const cached = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');
const seed = (value: unknown) => localStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value));

describe('viewerAccountKind', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(requestConfluenceJson).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('is anonymous without an accountId and makes no request or cache write', async () => {
    const fetchCurrentUser = vi.fn();
    for (const id of [undefined, '']) {
      expect(await viewerAccountKind({ accountId: id, clientDomain, now: NOW, fetchCurrentUser })).toBe('anonymous');
    }
    expect(fetchCurrentUser).not.toHaveBeenCalled();
    expect(requestConfluenceJson).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('is guest when the current user reports isGuest: true, and caches it', async () => {
    const fetchCurrentUser = vi.fn(async () => ({ accountId, isGuest: true }));
    expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe('guest');
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
    expect(cached()).toEqual({ kind: 'guest', at: NOW });
  });

  it('is licensed when the current user reports isGuest: false, and caches it', async () => {
    const fetchCurrentUser = vi.fn(async () => ({ accountId, isGuest: false }));
    expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe('licensed');
    expect(cached()).toEqual({ kind: 'licensed', at: NOW });
  });

  it('is unknown (fail open) when the request throws, and does not cache it', async () => {
    const fetchCurrentUser = vi.fn(async () => { throw new Error('network down'); });
    expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe('unknown');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is unknown for a non-object or a response without a boolean isGuest, and does not cache it', async () => {
    for (const body of [null, undefined, 'guest', 42, [], {}, { isGuest: 'true' }, { isGuest: null }, { isGuest: 1 }]) {
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser: async () => body })).toBe('unknown');
    }
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('answers from the cache without a request', async () => {
    for (const kind of ['guest', 'licensed'] as const) {
      seed({ kind, at: NOW - 1000 });
      const fetchCurrentUser = vi.fn();
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe(kind);
      expect(fetchCurrentUser).not.toHaveBeenCalled();
    }
  });

  it('expires the cache after 24 hours and refreshes it', async () => {
    seed({ kind: 'guest', at: NOW - DAY + 1 });
    const stillFresh = vi.fn();
    expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser: stillFresh })).toBe('guest');
    expect(stillFresh).not.toHaveBeenCalled();

    seed({ kind: 'guest', at: NOW - DAY });
    const fetchCurrentUser = vi.fn(async () => ({ isGuest: false }));
    expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe('licensed');
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
    expect(cached()).toEqual({ kind: 'licensed', at: NOW });
  });

  it('ignores unusable cache entries', async () => {
    for (const entry of ['not json', '"guest"', { kind: 'unknown', at: NOW }, { kind: 'anonymous', at: NOW },
      { kind: 'guest', at: 'yesterday' }, { kind: 'guest' }, { kind: 'guest', at: NOW + DAY }]) {
      seed(entry as any);
      const fetchCurrentUser = vi.fn(async () => ({ isGuest: false }));
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe('licensed');
      expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
    }
  });

  it('keys the cache by client domain and account', async () => {
    seed({ kind: 'guest', at: NOW });
    const fetchCurrentUser = vi.fn(async () => ({ isGuest: false }));
    expect(await viewerAccountKind({ accountId: 'other', clientDomain, now: NOW, fetchCurrentUser })).toBe('licensed');
    expect(await viewerAccountKind({ accountId, clientDomain: 'other-tenant', now: NOW, fetchCurrentUser })).toBe('licensed');
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('tolerates storage that throws on read and write', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const fetchCurrentUser = vi.fn(async () => ({ isGuest: true }));
    expect(await viewerAccountKind({ accountId, clientDomain, now: NOW, fetchCurrentUser })).toBe('guest');
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
  });

  describe('default lookup', () => {
    it('reads /wiki/rest/api/user/current as the viewer through requestConfluenceJson', async () => {
      vi.mocked(requestConfluenceJson).mockResolvedValue({ ok: true, status: 200, json: async () => ({ isGuest: true }) } as any);
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW })).toBe('guest');
      expect(requestConfluenceJson).toHaveBeenCalledWith('/wiki/rest/api/user/current', 'GET');
    });

    it('is unknown for a non-ok response, an unparseable body, or a rejected request', async () => {
      vi.mocked(requestConfluenceJson).mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ isGuest: true }) } as any);
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW })).toBe('unknown');
      vi.mocked(requestConfluenceJson).mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as any);
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW })).toBe('unknown');
      vi.mocked(requestConfluenceJson).mockRejectedValueOnce(new Error('bridge unavailable'));
      expect(await viewerAccountKind({ accountId, clientDomain, now: NOW })).toBe('unknown');
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });
});
