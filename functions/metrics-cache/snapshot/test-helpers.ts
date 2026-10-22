import { expect, vi } from 'vitest';
import { handleChunk } from './chunk';
import { sha256Hex, type SnapshotEnv } from './common';
import type { ForgeRequestData } from '../../utils/authenticate';

export class MemoryR2 {
  objects = new Map<string, { text: string; etag: string }>();
  sequence = 0;

  async put(key: string, value: unknown, options: { onlyIf?: R2Conditional } = {}) {
    const existing = this.objects.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && existing) return null;
    if (options.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
    const text = typeof value === 'string' ? value : String(value);
    const etag = `etag-${++this.sequence}`;
    this.objects.set(key, { text, etag });
    return { key, etag };
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      key,
      etag: stored.etag,
      text: async () => stored.text,
      json: async <T>() => JSON.parse(stored.text) as T,
    };
  }
}

export class MemoryKV {
  values = new Map<string, string>();
  put = vi.fn(async (key: string, value: string) => {
    this.values.set(key, value);
  });

  async get(key: string, type?: string) {
    const value = this.values.get(key) ?? null;
    return type === 'json' && value ? JSON.parse(value) : value;
  }
}

export const data: ForgeRequestData = {
  forgeContext: {
    cloudId: 'cloud-1',
    forgeAppId: '8ad26115-211f-4216-971b-0540f606303d',
    forgeAppAri: 'ari:cloud:ecosystem::app/8ad26115-211f-4216-971b-0540f606303d',
    installationId: 'installation-1',
    environmentType: 'STAGING',
    invocationSource: 'backend',
  },
};

export function request(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer verified-in-middleware',
      'Content-Type': 'application/json',
      'x-forge-oauth-system': 'opaque',
    },
    body: JSON.stringify(body),
  });
}

export function makeEnv() {
  const r2 = new MemoryR2();
  const metrics = new MemoryKV();
  const flags = new MemoryKV();
  flags.values.set('CUSTOMER_SUCCESS_SERVICE', JSON.stringify({ tenant: true }));
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ clientDomain: 'tenant.atlassian.net' })),
      })),
    })),
  };
  return {
    env: {
      ALLOWED_FORGE_APP_IDS: data.forgeContext?.forgeAppId,
      EXPECTED_FORGE_ENVIRONMENT_TYPE: 'STAGING',
      DB: db as unknown as D1Database,
      MACRO_COUNT_SNAPSHOT_BUCKET: r2 as unknown as R2Bucket,
      confluence_plugin_features: metrics as unknown as KVNamespace,
      KV_FEATURE_FLAGS: flags as unknown as KVNamespace,
    } satisfies SnapshotEnv,
    r2,
    metrics,
  };
}

export async function upload(
  env: SnapshotEnv,
  runId: string,
  body: { kind: 'content' | 'space' | 'aggregate'; spaceId?: string; index?: number; rowCount: number; payload: unknown },
) {
  const serialized = JSON.stringify(body.payload);
  const sha256 = await sha256Hex(serialized);
  const response = await handleChunk(request('/metrics-cache/snapshot/chunk', {
    runId,
    ...body,
    sha256,
  }), env, data);
  expect(response.status).toBe(201);
  return response.json() as Promise<{ key: string; rowCount: number; sha256: string }>;
}
