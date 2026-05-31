import { describe, it, expect, vi } from 'vitest'
import { onRequest } from '../../functions/ai-generate-title'

const env: any = { AI: { run: async () => ({ response: '"""Order Checkout"""' }) } }
const req = (method: string, body?: any) =>
  new Request('https://example.com/ai-generate-title', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

describe('ai-generate-title onRequest', () => {
  it('answers the CORS preflight (OPTIONS) with allow headers', async () => {
    const res = await onRequest({ request: req('OPTIONS'), env })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('rejects non-POST methods with 405', async () => {
    const res = await onRequest({ request: req('GET'), env })
    expect(res.status).toBe(405)
  })

  it('returns the extracted title for a valid POST', async () => {
    const res = await onRequest({ request: req('POST', { dsl: 'A->B: hi', type: 'sequence' }), env })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Order Checkout')
  })

  it('returns 400 when dsl is missing from body', async () => {
    const ai = { run: vi.fn() }
    const request = req('POST', { type: 'sequence' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('dsl')
  })

  it('returns 400 for invalid JSON', async () => {
    const ai = { run: vi.fn() }
    const request = new Request('https://example.com/ai-generate-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Invalid JSON body')
  })

  it('returns 200 with extracted title when strategy 1 matches triple-quoted title', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: '"""My Diagram Title"""' }),
    }
    const request = req('POST', { dsl: 'A -> B: hello', type: 'sequence' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('My Diagram Title')
  })

  it('returns 500 when both strategies fail to extract a title', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: 'No title here at all' }),
    }
    const request = req('POST', { dsl: 'A -> B: hello' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(500)
  })
})
