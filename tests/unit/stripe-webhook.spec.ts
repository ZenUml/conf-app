import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onRequest, parseClientReference } from '../../functions/api/stripe-webhook'

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

// The Payment Link purchase surface (useCustomerSuccessService.enterpriseBundleUrl)
// stamps client_reference_id="<domain>__<spaceKey>" because Payment Links cannot
// set metadata (unlike a Checkout Session created via the API). Before this fix
// the webhook read ONLY session.metadata, so every Payment Link purchase 400'd
// with "missing_metadata" and no space license was ever activated.
describe('parseClientReference', () => {
  it('splits a normal reference at the first "__"', () => {
    expect(parseClientReference('example-tenant__ENG')).toEqual({
      domain: 'example-tenant',
      spaceKey: 'ENG',
    })
  })

  it('keeps a spaceKey that itself contains "_" intact (splits at the FIRST "__" only)', () => {
    expect(parseClientReference('example-tenant__MY_SPACE')).toEqual({
      domain: 'example-tenant',
      spaceKey: 'MY_SPACE',
    })
  })

  it('returns null when the reference has no "__" delimiter', () => {
    expect(parseClientReference('example-tenant-ENG')).toBeNull()
  })

  it('returns null when the domain part is empty', () => {
    expect(parseClientReference('__ENG')).toBeNull()
  })

  it('returns null when the spaceKey part is empty', () => {
    expect(parseClientReference('example-tenant__')).toBeNull()
  })

  it('returns null for an uppercase domain (invalid Confluence subdomain char)', () => {
    expect(parseClientReference('Example-Tenant__ENG')).toBeNull()
  })

  it('returns null for a domain containing an invalid character (e.g. "_")', () => {
    expect(parseClientReference('example_tenant__ENG')).toBeNull()
  })

  it('returns null for null/undefined input', () => {
    expect(parseClientReference(null)).toBeNull()
    expect(parseClientReference(undefined)).toBeNull()
    expect(parseClientReference('')).toBeNull()
  })
})

describe('onRequest — client_reference_id activation fallback (flow)', () => {
  const SECRET = 'whsec_test_secret'

  // Reproduces verifyStripeSignature's own HMAC so these flow tests can
  // present a signature the handler actually accepts, proving the fallback
  // is reachable end-to-end and not just unit-testable in isolation.
  async function signPayload(payload: string, secret: string): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signed = `${timestamp}.${payload}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `t=${timestamp},v1=${hex}`
  }

  function makeKV() {
    const store: Record<string, string> = {}
    return {
      store,
      get: vi.fn(async (k: string) => store[k] ?? null),
      put: vi.fn(async (k: string, v: string) => {
        store[k] = v
      }),
    }
  }

  async function makeRequest(session: Record<string, unknown>) {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: session },
    })
    const signature = await signPayload(payload, SECRET)
    return new Request('https://example.com/api/stripe-webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: payload,
    })
  }

  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('activates via client_reference_id when metadata has no cloudId/spaceKey (fetch resolves cloudId)', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ cloudId: 'cloud-resolved' }), { status: 200 })
    ) as unknown as typeof fetch

    const kv = makeKV()
    const request = await makeRequest({
      id: 'cs_test_ref_1',
      customer_email: 'buyer@example.com',
      metadata: {},
      client_reference_id: 'example-tenant__ENG',
    })

    const response = await onRequest({
      request,
      env: { STRIPE_WEBHOOK_SECRET: SECRET, SPACE_LICENSE_KV: kv as unknown as KVNamespace },
    } as any)

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.cloudId).toBe('cloud-resolved')
    expect(body.spaceKey).toBe('ENG')
    expect(global.fetch).toHaveBeenCalledWith('https://example-tenant.atlassian.net/_edge/tenant_info')
    expect(JSON.parse(kv.store['license:cloud-resolved:ENG'])).toMatchObject({ status: 'active' })
  })

  it('returns 500 (not 400) when tenant_info resolution fails, so Stripe retries the event', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 })) as unknown as typeof fetch

    const kv = makeKV()
    const request = await makeRequest({
      id: 'cs_test_ref_2',
      customer_email: 'buyer@example.com',
      metadata: {},
      client_reference_id: 'example-tenant__ENG',
    })

    const response = await onRequest({
      request,
      env: { STRIPE_WEBHOOK_SECRET: SECRET, SPACE_LICENSE_KV: kv as unknown as KVNamespace },
    } as any)

    expect(response.status).toBe(500)
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('returns 400 when metadata is empty AND client_reference_id is unparseable (no fetch attempted)', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch

    const kv = makeKV()
    const request = await makeRequest({
      id: 'cs_test_ref_3',
      customer_email: 'buyer@example.com',
      metadata: {},
      client_reference_id: 'not-a-valid-reference',
    })

    const response = await onRequest({
      request,
      env: { STRIPE_WEBHOOK_SECRET: SECRET, SPACE_LICENSE_KV: kv as unknown as KVNamespace },
    } as any)

    expect(response.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('still activates from metadata directly when metadata carries cloudId/spaceKey (client_reference_id ignored)', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch

    const kv = makeKV()
    const request = await makeRequest({
      id: 'cs_test_ref_4',
      customer_email: 'buyer@example.com',
      metadata: { cloudId: 'cloud-from-metadata', spaceKey: 'ENG' },
      client_reference_id: 'example-tenant__ENG',
    })

    const response = await onRequest({
      request,
      env: { STRIPE_WEBHOOK_SECRET: SECRET, SPACE_LICENSE_KV: kv as unknown as KVNamespace },
    } as any)

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.cloudId).toBe('cloud-from-metadata')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
