import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock authentication + Sentry so onRequest can be exercised without a real
// JWT/JWKS round-trip and without Sentry console noise.
vi.mock('../utils/authenticate', () => ({
  validateContextToken: vi.fn(),
}));
vi.mock('../utils/sentry', () => ({
  captureError: vi.fn(),
}));

import { onRequest, resolveCohorts } from './user-cohorts';
import { validateContextToken } from '../utils/authenticate';

describe('resolveCohorts', () => {
  it('returns [] for a KV miss', () => {
    expect(resolveCohorts(null)).toEqual([]);
  });
  it('returns the cohorts array from a valid record', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: ['vs-copier', 't1-lapsed-author-strict'] })))
      .toEqual(['vs-copier', 't1-lapsed-author-strict']);
  });
  it('returns [] for malformed JSON', () => {
    expect(resolveCohorts('{oops')).toEqual([]);
  });
  it('returns [] when cohorts is not an array', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: 'vs-copier' }))).toEqual([]);
  });
  it('drops non-string entries', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: ['a', 1, null, 'b'] }))).toEqual(['a', 'b']);
  });
});

describe('user-cohorts onRequest', () => {
  const PRINCIPAL = 'account-mocked-principal';

  function makeEnv(kvData: Record<string, string | null> = {}) {
    return {
      ALLOWED_FORGE_APP_IDS: 'app-1',
      SPACE_LICENSE_KV: {
        get: vi.fn(async (key: string) => (key in kvData ? kvData[key] : null)),
      },
    };
  }

  function makeRequest(opts: { method?: string; auth?: string | null; query?: string } = {}): Request {
    const { method = 'GET', auth = 'Bearer t', query = '' } = opts;
    const headers: Record<string, string> = {};
    if (auth !== null) headers.Authorization = auth;
    return new Request(`https://x/api/user-cohorts${query}`, { method, headers });
  }

  beforeEach(() => {
    vi.mocked(validateContextToken).mockReset();
    vi.mocked(validateContextToken).mockResolvedValue({
      payload: { principal: PRINCIPAL },
    } as never);
  });

  it('derives the KV key from the token principal, ignoring any query param', async () => {
    const env = makeEnv({ [`cohort:user:${PRINCIPAL}`]: JSON.stringify({ cohorts: ['vs-copier'] }) });
    const request = makeRequest({ query: '?accountId=attacker' });

    const res = await onRequest({ request, env } as unknown as Parameters<typeof onRequest>[0]);

    expect(res.status).toBe(200);
    expect(env.SPACE_LICENSE_KV.get).toHaveBeenCalledWith(`cohort:user:${PRINCIPAL}`);
    expect(env.SPACE_LICENSE_KV.get).not.toHaveBeenCalledWith(expect.stringContaining('attacker'));
    const body = await res.json() as { cohorts: string[]; accountId: string };
    expect(body.cohorts).toEqual(['vs-copier']);
    expect(body.accountId).toBe(PRINCIPAL);
  });

  it('returns 401 with an empty cohorts array when Authorization is missing', async () => {
    const env = makeEnv();
    const request = makeRequest({ auth: null });

    const res = await onRequest({ request, env } as unknown as Parameters<typeof onRequest>[0]);

    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json() as { cohorts: string[] };
    expect(body.cohorts).toEqual([]);
    expect(validateContextToken).not.toHaveBeenCalled();
  });

  it('returns 405 for non-GET requests', async () => {
    const env = makeEnv();
    const request = makeRequest({ method: 'POST' });

    const res = await onRequest({ request, env } as unknown as Parameters<typeof onRequest>[0]);

    expect(res.status).toBe(405);
  });

  it('returns 200 with cohorts from KV and a private cache header on the happy path', async () => {
    const env = makeEnv({ [`cohort:user:${PRINCIPAL}`]: JSON.stringify({ cohorts: ['vs-copier', 't1-lapsed-author-strict'] }) });
    const request = makeRequest();

    const res = await onRequest({ request, env } as unknown as Parameters<typeof onRequest>[0]);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    const body = await res.json() as { cohorts: string[]; accountId: string };
    expect(body.cohorts).toEqual(['vs-copier', 't1-lapsed-author-strict']);
    expect(body.accountId).toBe(PRINCIPAL);
  });
});
