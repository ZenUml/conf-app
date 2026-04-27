import type { SpaceLicenseRecord } from './space-license'

interface Env {
  SPACE_LICENSE_KV: KVNamespace
  STRIPE_WEBHOOK_SECRET: string
}

interface StripeCheckoutSession {
  id: string
  customer_email: string | null
  customer_details?: { email?: string }
  metadata: Record<string, string>
}

interface StripeEvent {
  type: string
  data: { object: StripeCheckoutSession }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const parts = Object.fromEntries(
    signature.split(',').map((p) => {
      const idx = p.indexOf('=')
      return [p.slice(0, idx), p.slice(idx + 1)]
    })
  )
  const timestamp = parts['t']
  const expectedHash = parts['v1']
  if (!timestamp || !expectedHash) return false

  const signed = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
  const computed = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (computed.length !== expectedHash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expectedHash.charCodeAt(i)
  }
  return diff === 0
}

async function activateLicense(
  kv: KVNamespace,
  cloudId: string,
  spaceKey: string,
  stripeSessionId: string,
  activatedBy: string
): Promise<void> {
  const key = `license:${cloudId}:${spaceKey}`
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

  const existing = await kv.get(key)
  let record: SpaceLicenseRecord

  if (existing) {
    const parsed = JSON.parse(existing) as SpaceLicenseRecord
    record = {
      ...parsed,
      status: 'active',
      activatedBy,
      expiresAt,
      paymentReference: stripeSessionId,
      updatedAt: now,
    }
  } else {
    record = {
      cloudId,
      spaceKey,
      status: 'active',
      activatedBy,
      paymentReference: stripeSessionId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    }
  }

  await kv.put(key, JSON.stringify(record))

  const indexRaw = await kv.get('license-index')
  const index: Array<{ cloudId: string; spaceKey: string }> = indexRaw
    ? JSON.parse(indexRaw)
    : []
  if (!index.some((e) => e.cloudId === cloudId && e.spaceKey === spaceKey)) {
    index.push({ cloudId, spaceKey })
    await kv.put('license-index', JSON.stringify(index))
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' })
  }

  if (!env.STRIPE_WEBHOOK_SECRET || !env.SPACE_LICENSE_KV) {
    console.error('Missing STRIPE_WEBHOOK_SECRET or SPACE_LICENSE_KV binding')
    return jsonResponse(500, { error: 'server_configuration' })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return jsonResponse(400, { error: 'missing_signature' })
  }

  const payload = await request.text()
  const valid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET)
  if (!valid) {
    return jsonResponse(400, { error: 'invalid_signature' })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(payload) as StripeEvent
  } catch {
    return jsonResponse(400, { error: 'invalid_json' })
  }

  if (event.type !== 'checkout.session.completed') {
    return jsonResponse(200, { received: true, action: 'ignored' })
  }

  const session = event.data.object
  const { cloudId, spaceKey } = session.metadata ?? {}

  if (!cloudId || !spaceKey) {
    console.error('Stripe session missing cloudId or spaceKey in metadata', session.id)
    return jsonResponse(400, {
      error: 'missing_metadata',
      message: 'Checkout session metadata must include cloudId and spaceKey',
    })
  }

  const activatedBy =
    session.customer_details?.email ?? session.customer_email ?? 'stripe-webhook'

  try {
    await activateLicense(env.SPACE_LICENSE_KV, cloudId, spaceKey, session.id, activatedBy)
    console.log(`Space license activated: ${cloudId}/${spaceKey} via Stripe session ${session.id}`)
    return jsonResponse(200, { received: true, cloudId, spaceKey })
  } catch (error) {
    console.error('Failed to activate license:', error)
    return jsonResponse(500, { error: 'activation_failed' })
  }
}
