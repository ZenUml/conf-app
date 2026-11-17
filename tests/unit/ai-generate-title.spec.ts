import { describe, it, expect, vi } from 'vitest'
import { onRequest } from '../../functions/ai-generate-title'

const env: any = { AI: { run: async () => ({ response: '"""Order Checkout"""' }) } }
const req = (method: string, body?: any) =>
  new Request('https://example.com/ai-generate-title', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

// Cloudflare's non-streaming Gemma example uses the chat completion shape:
// https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
const gemmaReply = (content: unknown) => ({
  id: 'test-completion',
  object: 'chat.completion',
  created: 0,
  model: '@cf/google/gemma-4-26b-a4b-it',
  choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop', logprobs: null }],
})

describe('ai-generate-title onRequest', () => {
  it.each([
    ['sequence', 'Customer->Shop: order', 'Order Checkout', 'sequence diagram'],
    ['flowchart', 'flowchart LR\nA[Order] --> B[Ship]', 'Order Shipping', 'flowchart diagram'],
    ['plantuml', '@startuml\nUser -> Server: login\n@enduml', 'Login Flow', 'plantuml diagram'],
    ['OpenAPI specification', 'openapi: 3.0.0\ninfo:\n  title: Inventory', 'Inventory API', 'OpenAPI specification'],
  ])('uses the supported non-thinking primary for %s', async (type, dsl, title, promptType) => {
    const ai = { run: vi.fn().mockResolvedValue(gemmaReply(`"""${title}"""`)) }
    const response = await onRequest({ request: req('POST', { dsl, type }), env: { AI: ai as any } })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(title)
    expect(ai.run).toHaveBeenCalledTimes(1)
    expect(ai.run).toHaveBeenCalledWith('@cf/google/gemma-4-26b-a4b-it', {
      messages: [
        { role: 'system', content: expect.stringContaining(promptType) },
        { role: 'user', content: dsl },
      ],
      chat_template_kwargs: { enable_thinking: false },
      max_completion_tokens: 128,
    })
  })

  it('reads final content without using a separate reasoning field as the title', async () => {
    const reply = gemmaReply('Order Processing')
    Object.assign(reply.choices[0].message, { reasoning_content: 'An internal draft called "Wrong Title"' })
    const ai = { run: vi.fn().mockResolvedValue(reply) }
    const response = await onRequest({ request: req('POST', { dsl: 'A->B: order' }), env: { AI: ai as any } })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Order Processing')
    expect(ai.run).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['null response', null],
    ['undefined response', undefined],
    ['string response instead of an envelope', 'Order Flow'],
    ['empty envelope', {}],
    ['non-array choices', { choices: {} }],
    ['empty choices', { choices: [] }],
    ['null choice', { choices: [null] }],
    ['missing message', { choices: [{}] }],
    ['missing content', { choices: [{ message: {} }] }],
    ['object content', gemmaReply({ title: 'Wrong Title' })],
    ['array content', gemmaReply(['Wrong Title'])],
    ['number content', gemmaReply(123)],
    ['boolean content', gemmaReply(true)],
    ['null content', gemmaReply(null)],
    ['empty content', gemmaReply('')],
    ['whitespace content', gemmaReply('  \n  ')],
    ['reasoning only', { choices: [{ message: { content: null, reasoning_content: '"Wrong Title"' } }] }],
    ['missing final content with reasoning', { choices: [{ message: { reasoning_content: '"Wrong Title"' } }] }],
    ['unparsed Gemma thought channel', gemmaReply('<|channel>thought\n"Wrong Title"<channel|>')],
    ['unparsed thinking tags', gemmaReply('<think>"Wrong Title"</think>')],
    ['refusal text', gemmaReply('Please provide the DSL for this diagram.')],
    ['object legacy response', { response: { title: 'Wrong Title' } }],
    ['array legacy response', { response: ['Wrong Title'] }],
    ['number legacy response', { response: 123 }],
  ])('falls back to the legacy-response model on %s', async (_label, primaryReply) => {
    const ai = {
      run: vi.fn().mockResolvedValueOnce(primaryReply).mockResolvedValueOnce({ response: 'Recovered Title' }),
    }
    const response = await onRequest({ request: req('POST', { dsl: 'A->B: order' }), env: { AI: ai as any } })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Recovered Title')
    expect(ai.run).toHaveBeenCalledTimes(2)
    expect(ai.run.mock.calls[0][0]).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(ai.run.mock.calls[1][0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
    expect(ai.run.mock.calls[1][1]).not.toHaveProperty('chat_template_kwargs')
    expect(ai.run.mock.calls[1][1]).not.toHaveProperty('max_completion_tokens')
  })

  it('returns 500 with CORS headers when neither model has string content', async () => {
    const ai = {
      run: vi.fn().mockResolvedValueOnce(gemmaReply({ title: 'Wrong Title' })).mockResolvedValueOnce({ response: {} }),
    }
    const response = await onRequest({ request: req('POST', { dsl: 'A->B: order' }), env: { AI: ai as any } })

    expect(response.status).toBe(500)
    expect(await response.text()).toContain('Failed to extract title')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(ai.run).toHaveBeenCalledTimes(2)
  })

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
    expect(primaryModel).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(fallbackModel).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
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

  describe('model replies that are not titles', () => {
    const REFUSAL =
      "Please provide the DSL (Domain Specific Language) describing the flowchart diagram. I'll help you create a concise title."

    it('tries the fallback model when the primary model asks for the DSL', async () => {
      const ai = {
        run: vi
          .fn()
          .mockResolvedValueOnce({ response: REFUSAL })
          .mockResolvedValueOnce({ response: 'Control Flow' }),
      }
      const response = await onRequest({ request: req('POST', { dsl: 'A\nB', type: 'flowchart' }), env: { AI: ai as any } })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Control Flow')
      expect(ai.run).toHaveBeenCalledTimes(2)
    })

    it.each(['flowchart', 'flow chart', 'plantuml'])(
      'does not call a %s diagram a ZenUML sequence diagram in the fallback prompt',
      async (type) => {
        const ai = {
          run: vi
            .fn()
            .mockResolvedValueOnce({ response: REFUSAL })
            .mockResolvedValueOnce({ response: 'Control Flow' }),
        }
        await onRequest({ request: req('POST', { dsl: 'A\nB', type }), env: { AI: ai as any } })
        const fallbackPrompt = ai.run.mock.calls[1][1].messages[0].content
        expect(fallbackPrompt).not.toMatch(/ZenUML|sequence/i)
        expect(fallbackPrompt).toContain(type)
      },
    )

    it('answers 422 not_title_like when both models refuse', async () => {
      const ai = { run: vi.fn().mockResolvedValue({ response: REFUSAL }) }
      const response = await onRequest({ request: req('POST', { dsl: 'A\nB', type: 'flowchart' }), env: { AI: ai as any } })
      expect(response.status).toBe(422)
      expect(await response.text()).toBe('not_title_like')
    })

    it('judges the whole first line, before the 80-character cut hides the question mark', async () => {
      const longQuestion =
        'To help you with the title of this flowchart, what is the system that the diagram is meant to describe here?'
      const ai = { run: vi.fn().mockResolvedValue({ response: longQuestion }) }
      const response = await onRequest({ request: req('POST', { dsl: 'A\nB', type: 'flowchart' }), env: { AI: ai as any } })
      expect(response.status).toBe(422)
    })

    it('still returns a real title that is cut to 80 characters', async () => {
      const longTitle = 'Order Fulfilment Across Warehouses, Carriers and Customer Support Escalation Paths'
      const ai = { run: vi.fn().mockResolvedValue({ response: `"""${longTitle}"""` }) }
      const response = await onRequest({ request: req('POST', { dsl: 'A\nB', type: 'flowchart' }), env: { AI: ai as any } })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(longTitle.slice(0, 80))
    })
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
