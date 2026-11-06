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

  it('falls back to the first non-empty line when the model omits triple quotes', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: 'Order Processing' }),
    }
    const request = req('POST', { dsl: 'Customer->Shop: order', type: 'sequence' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Order Processing')
  })

  it('strips a leading "Title:" label and surrounding quotes', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: 'Title: "Login Flow"' }),
    }
    const request = req('POST', { dsl: 'User->Server: login', type: 'sequence' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Login Flow')
  })

  it('falls back to a DIFFERENT model when the primary model fails', async () => {
    // Regression guard for the deprecation outages (llama-2-7b-chat-int8, then
    // llama-3.1-8b-instruct): both strategies once shared one model, so a single
    // deprecation took down the whole fallback chain. The two strategies must run
    // on distinct models for the fallback to be meaningful.
    const ai = {
      run: vi
        .fn()
        .mockRejectedValueOnce(new Error('AiError: 5028: This model was deprecated'))
        .mockResolvedValueOnce({ response: '"""Recovered Title"""' }),
    }
    const request = req('POST', { dsl: 'A -> B: hello', type: 'sequence' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Recovered Title')
    expect(ai.run).toHaveBeenCalledTimes(2)
    const primaryModel = ai.run.mock.calls[0][0]
    const fallbackModel = ai.run.mock.calls[1][0]
    expect(primaryModel).not.toBe(fallbackModel)
    expect(ai.run.mock.calls[0][1].messages[0].content).toContain('sequence diagram')
    expect(ai.run.mock.calls[1][1].messages[0].content).toContain('ZenUML sequence diagram')
  })

  it('uses an OpenAPI-specific prompt in both model strategies', async () => {
    const ai = {
      run: vi
        .fn()
        .mockRejectedValueOnce(new Error('primary unavailable'))
        .mockResolvedValueOnce({ response: '"""Inventory API"""' }),
    }
    const request = req('POST', {
      dsl: 'openapi: 3.0.0\ninfo:\n  title: Inventory',
      type: 'OpenAPI specification',
    })
    const response = await onRequest({ request, env: { AI: ai as any } })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Inventory API')
    expect(ai.run).toHaveBeenCalledTimes(2)
    for (const call of ai.run.mock.calls) {
      const systemPrompt = call[1].messages[0].content
      expect(systemPrompt).toContain('OpenAPI specification')
      expect(systemPrompt).not.toContain('sequence diagram')
    }
  })

  it('returns 500 only when the response has no usable text', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ response: '   \n  ' }),
    }
    const request = req('POST', { dsl: 'A -> B: hello' })
    const response = await onRequest({ request, env: { AI: ai as any } })
    expect(response.status).toBe(500)
  })
})
