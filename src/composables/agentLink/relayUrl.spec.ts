import { describe, it, expect, vi, afterEach } from 'vitest'
import { agentLinkWsUrl, mintAgentLinkSession, toWebSocketBaseUrl } from './relayUrl'

describe('toWebSocketBaseUrl', () => {
  it('upgrades https:// to wss://', () => {
    expect(toWebSocketBaseUrl('https://conf-stg-lite.zenuml.com')).toBe(
      'wss://conf-stg-lite.zenuml.com'
    )
  })

  it('upgrades http:// to ws:// (local dev)', () => {
    expect(toWebSocketBaseUrl('http://localhost:8788')).toBe('ws://localhost:8788')
  })
})

describe('agentLinkWsUrl', () => {
  it('builds the peer=macro channel URL from a sample backend host + bound context', () => {
    const url = agentLinkWsUrl(
      'tok_abc123',
      { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' },
      'https://conf-stg-lite.zenuml.com'
    )

    expect(url).toBe(
      'wss://conf-stg-lite.zenuml.com/agent-link/channel?' +
        'token=tok_abc123&peer=macro&cloudId=cloud-1&pageId=page-1&contentId=content-1'
    )
  })

  it('does not hardcode any specific backend host — a different host round-trips too', () => {
    const url = agentLinkWsUrl(
      'tok',
      { cloudId: 'c', pageId: 'p', contentId: 'd' },
      'https://conf-full.zenuml.com'
    )
    expect(url.startsWith('wss://conf-full.zenuml.com/agent-link/channel?')).toBe(true)
  })
})

describe('mintAgentLinkSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the bound context to <backendBaseUrl>/agent-link/session and returns the parsed token response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ token: 'tok_xyz', channelUrl: '/agent-link/channel?token=tok_xyz', expiresInSec: 600 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' }
    const result = await mintAgentLinkSession(ctx, 'https://conf-stg-lite.zenuml.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://conf-stg-lite.zenuml.com/agent-link/session',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx),
      })
    )
    expect(result).toEqual({ token: 'tok_xyz', channelUrl: '/agent-link/channel?token=tok_xyz', expiresInSec: 600 })
  })

  it('throws when the relay responds non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(
      mintAgentLinkSession({ cloudId: 'c', pageId: 'p', contentId: 'd' }, 'https://conf-stg-lite.zenuml.com')
    ).rejects.toThrow('HTTP 500')
  })

  it('includes the relay error code on a 409 already-linked response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'diagram_already_linked' }),
      })
    )

    await expect(
      mintAgentLinkSession({ cloudId: 'c', pageId: 'p', contentId: 'd' }, 'https://conf-stg-lite.zenuml.com')
    ).rejects.toMatchObject({
      status: 409,
      error: 'diagram_already_linked',
    })
  })
})
