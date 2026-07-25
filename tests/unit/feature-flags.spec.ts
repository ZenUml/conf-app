import { describe, expect, it } from 'vitest';
import { onRequestGet } from '../../functions/feature-flags';

class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeKV(data: Record<string, string> = {}): MockKV {
  const kv = new MockKV();
  for (const [k, v] of Object.entries(data)) {
    kv.put(k, v);
  }
  return kv;
}

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('https://example.com/feature-flags');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

function makeContext(params: Record<string, string>, kvData: Record<string, string> = {}) {
  return {
    request: makeRequest(params),
    env: { KV_FEATURE_FLAGS: makeKV(kvData) as unknown as KVNamespace },
  };
}

describe('feature-flags onRequestGet', () => {
  describe('validation', () => {
    it('returns 400 when client is missing', async () => {
      const ctx = makeContext({ features: 'TEST' });
      const response = await onRequestGet(ctx);
      expect(response.status).toBe(400);
    });

    it('returns 400 when features is missing', async () => {
      const ctx = makeContext({ client: 'example.atlassian.net' });
      const response = await onRequestGet(ctx);
      expect(response.status).toBe(400);
    });
  });

  describe('CUSTOMER_SUCCESS_SERVICE', () => {
    it('returns CUSTOMER_SUCCESS_SERVICE for matching domain', async () => {
      const cssValue = { 'example.atlassian.net': { plan: 'enterprise' } };
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'CUSTOMER_SUCCESS_SERVICE' },
        { CUSTOMER_SUCCESS_SERVICE: JSON.stringify(cssValue) },
      );
      const response = await onRequestGet(ctx);
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body.CUSTOMER_SUCCESS_SERVICE).toEqual({ plan: 'enterprise' });
    });

    it('returns empty object when client does not match CUSTOMER_SUCCESS_SERVICE', async () => {
      const cssValue = { 'other.atlassian.net': { plan: 'enterprise' } };
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'CUSTOMER_SUCCESS_SERVICE' },
        { CUSTOMER_SUCCESS_SERVICE: JSON.stringify(cssValue) },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json() as Record<string, unknown>;
      expect(body.CUSTOMER_SUCCESS_SERVICE).toBeUndefined();
    });
  });

  describe('unknown features', () => {
    it('returns an empty object for a feature name the endpoint does not serve', async () => {
      const ctx = makeContext({ client: 'example.atlassian.net', features: 'LITE_PNG_EXPORT,TEST' });
      const response = await onRequestGet(ctx);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toEqual({});
    });
  });
});
