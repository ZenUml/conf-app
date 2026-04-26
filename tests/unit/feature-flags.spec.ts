import { describe, expect, it, beforeEach } from 'vitest';
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
      const body = await response.json();
      expect(body.CUSTOMER_SUCCESS_SERVICE).toEqual({ plan: 'enterprise' });
    });

    it('returns empty object when client does not match CUSTOMER_SUCCESS_SERVICE', async () => {
      const cssValue = { 'other.atlassian.net': { plan: 'enterprise' } };
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'CUSTOMER_SUCCESS_SERVICE' },
        { CUSTOMER_SUCCESS_SERVICE: JSON.stringify(cssValue) },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.CUSTOMER_SUCCESS_SERVICE).toBeUndefined();
    });
  });

  describe('LITE_PNG_EXPORT', () => {
    it('returns LITE_PNG_EXPORT with status ENABLED for matching domain', async () => {
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'LITE_PNG_EXPORT' },
        { LITE_PNG_EXPORT_ENABLED: 'example.atlassian.net,other.atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.LITE_PNG_EXPORT).toEqual({ status: 'ENABLED' });
    });

    it('returns LITE_PNG_EXPORT with status TRIAL for matching domain', async () => {
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'LITE_PNG_EXPORT' },
        { LITE_PNG_EXPORT_TRIAL: 'example.atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.LITE_PNG_EXPORT).toEqual({ status: 'TRIAL' });
    });

    it('returns LITE_PNG_EXPORT with status LOCKED for matching domain', async () => {
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'LITE_PNG_EXPORT' },
        { LITE_PNG_EXPORT_LOCKED: 'example.atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.LITE_PNG_EXPORT).toEqual({ status: 'LOCKED' });
    });

    it('returns empty object when client only partially matches LITE_PNG_EXPORT (exact match required)', async () => {
      // LITE_PNG_EXPORT uses exact match (client === d), not substring
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'LITE_PNG_EXPORT' },
        { LITE_PNG_EXPORT_ENABLED: 'atlassian.net' }, // substring, not exact
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.LITE_PNG_EXPORT).toBeUndefined();
    });

    it('trims whitespace from comma-separated domain lists', async () => {
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'LITE_PNG_EXPORT' },
        { LITE_PNG_EXPORT_ENABLED: 'other.atlassian.net, example.atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.LITE_PNG_EXPORT).toEqual({ status: 'ENABLED' });
    });
  });

  describe('AI_TITLE', () => {
    it('returns AI_TITLE enabled when client includes domain (substring match)', async () => {
      const ctx = makeContext(
        { client: 'mycompany.atlassian.net', features: 'AI_TITLE' },
        { AI_TITLE_ENABLED_DOMAINS: 'atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.AI_TITLE).toEqual({ enabled: true });
    });

    it('returns AI_TITLE disabled when client does not include any domain', async () => {
      const ctx = makeContext(
        { client: 'mycompany.atlassian.net', features: 'AI_TITLE' },
        { AI_TITLE_ENABLED_DOMAINS: 'example.com' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.AI_TITLE).toEqual({ enabled: false });
    });
  });

  describe('PERSONA_AWARE_PAYWALL', () => {
    it('returns PERSONA_AWARE_PAYWALL true for matching domain', async () => {
      const ctx = makeContext(
        { client: 'example.atlassian.net', features: 'PERSONA_AWARE_PAYWALL' },
        { PERSONA_AWARE_PAYWALL: 'example.atlassian.net,other.atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.PERSONA_AWARE_PAYWALL).toBe(true);
    });

    it('does not return PERSONA_AWARE_PAYWALL when client does not match', async () => {
      const ctx = makeContext(
        { client: 'nomatch.atlassian.net', features: 'PERSONA_AWARE_PAYWALL' },
        { PERSONA_AWARE_PAYWALL: 'example.atlassian.net' },
      );
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.PERSONA_AWARE_PAYWALL).toBeUndefined();
    });
  });

  describe('TEST', () => {
    it('returns TEST flag always', async () => {
      const ctx = makeContext({ client: 'any.atlassian.net', features: 'TEST' });
      const response = await onRequestGet(ctx);
      const body = await response.json();
      expect(body.TEST).toEqual({ enabled: true, data: 'test data' });
    });
  });
});
