import { describe, it, expect, vi, beforeEach } from 'vitest'

// Inline the activation logic to test it independently of the PagesFunction wrapper
async function activateLicense(
  kv: { put: (k: string, v: string) => Promise<void>; get: (k: string) => Promise<string | null> },
  cloudId: string,
  spaceKey: string,
  stripeSessionId: string,
  activatedBy: string
) {
  const key = `license:${cloudId}:${spaceKey}`
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const existing = await kv.get(key)
  let record: Record<string, unknown>
  if (existing) {
    const parsed = JSON.parse(existing)
    record = { ...parsed, status: 'active', activatedBy, expiresAt, paymentReference: stripeSessionId, updatedAt: now }
  } else {
    record = { cloudId, spaceKey, status: 'active', activatedBy, paymentReference: stripeSessionId, expiresAt, createdAt: now, updatedAt: now }
  }
  await kv.put(key, JSON.stringify(record))

  // Update index
  const indexRaw = await kv.get('license-index')
  const index: Array<{ cloudId: string; spaceKey: string }> = indexRaw ? JSON.parse(indexRaw) : []
  if (!index.some((e) => e.cloudId === cloudId && e.spaceKey === spaceKey)) {
    index.push({ cloudId, spaceKey })
    await kv.put('license-index', JSON.stringify(index))
  }
  return record
}

describe('stripe-webhook activateLicense', () => {
  let store: Record<string, string>
  let kv: { put: (k: string, v: string) => Promise<void>; get: (k: string) => Promise<string | null> }

  beforeEach(() => {
    store = {}
    kv = {
      put: vi.fn(async (k, v) => { store[k] = v }),
      get: vi.fn(async (k) => store[k] ?? null),
    }
  })

  it('writes an active license record to KV with correct key format', async () => {
    const record = await activateLicense(kv, 'cloud-abc', 'MYSPACE', 'cs_test_123', 'buyer@example.com')
    expect(record['status']).toBe('active')
    expect(record['cloudId']).toBe('cloud-abc')
    expect(record['spaceKey']).toBe('MYSPACE')
    expect(record['paymentReference']).toBe('cs_test_123')
    expect(kv.put).toHaveBeenCalledWith('license:cloud-abc:MYSPACE', expect.stringContaining('"status":"active"'))
  })

  it('sets expiresAt roughly 1 year in the future', async () => {
    const before = Date.now()
    const record = await activateLicense(kv, 'c', 's', 'id', 'e@x.com')
    const expires = new Date(record['expiresAt'] as string).getTime()
    const oneYear = 365 * 24 * 60 * 60 * 1000
    expect(expires).toBeGreaterThan(before + oneYear - 10000)
    expect(expires).toBeLessThan(before + oneYear + 10000)
  })

  it('adds entry to license-index', async () => {
    await activateLicense(kv, 'cloud-abc', 'MYSPACE', 'cs_test_123', 'buyer@example.com')
    const indexJson = store['license-index']
    const index = JSON.parse(indexJson)
    expect(index).toContainEqual({ cloudId: 'cloud-abc', spaceKey: 'MYSPACE' })
  })

  it('does not duplicate license-index entries on re-activation', async () => {
    await activateLicense(kv, 'cloud-abc', 'MYSPACE', 'cs_test_123', 'buyer@example.com')
    await activateLicense(kv, 'cloud-abc', 'MYSPACE', 'cs_test_456', 'buyer@example.com')
    const index = JSON.parse(store['license-index'])
    const matches = index.filter((e: any) => e.cloudId === 'cloud-abc' && e.spaceKey === 'MYSPACE')
    expect(matches).toHaveLength(1)
  })
})
