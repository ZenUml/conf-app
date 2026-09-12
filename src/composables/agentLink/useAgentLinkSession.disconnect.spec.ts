import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: { zenumlRemoteBaseUrl: 'https://backend.example' } }))
vi.mock('./relayUrl', async importOriginal => ({
  ...await importOriginal<typeof import('./relayUrl')>(),
  revokeAgentLinkSession: vi.fn().mockResolvedValue(undefined),
}))

import { useAgentLinkSession } from './useAgentLinkSession'
import { revokeAgentLinkSession } from './relayUrl'
import { persistSession, readSession, readSessionDisconnectRequest } from './sessionHandoff'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { AgentLinkBridgeOps } from './bridgeOps'
import type { RelayClient } from './relayClient'

const context = { cloudId: 'c1', pageId: 'disconnect-page', contentId: 'cc1' }
const handoff = { ...context, token: 'owner-token', state: 'connected' as const }
const bridge = (): AgentLinkBridgeOps => ({
  readPage: vi.fn(), readDiagram: vi.fn(), writeDiagram: vi.fn(), searchDiagrams: vi.fn(), listDiagrams: vi.fn(),
})

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(trackAnalyticsEvent).mockClear()
  vi.mocked(revokeAgentLinkSession).mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('confirmed Disconnect across inline and Fullscreen instances', () => {
  it('waits for HTTP revocation, then disconnects the exact inline owner without recursive revocation', async () => {
    const client: RelayClient = { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: () => 'open' }
    const ownerRevoke = vi.fn().mockResolvedValue(undefined)
    const owner = useAgentLinkSession(bridge(), { macroType: 'sequence', relay: {
      boundContext: context, revokeSession: ownerRevoke,
      requestSession: vi.fn().mockResolvedValue({ token: handoff.token }), connect: () => client,
    } })
    owner.startConnect()
    await vi.advanceTimersByTimeAsync(0)
    owner.onAgentConnected()
    const fullscreen = useAgentLinkSession(bridge(), { macroType: 'sequence' })
    fullscreen.hydrateFrom(readSession(context.pageId)!)
    let confirm!: () => void
    vi.mocked(revokeAgentLinkSession).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve }))
    vi.mocked(trackAnalyticsEvent).mockClear()

    fullscreen.disconnect()
    fullscreen.disconnect() // repeated click must reuse the in-flight request
    expect(revokeAgentLinkSession).toHaveBeenCalledTimes(1)
    expect(revokeAgentLinkSession).toHaveBeenCalledWith(handoff.token, context)
    expect(fullscreen.state.value).toBe('connected')
    expect(fullscreen.token.value).toBe(handoff.token)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(readSessionDisconnectRequest(context.pageId)).toBeNull()
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('agent_link_disconnected', expect.anything())

    confirm()
    await vi.advanceTimersByTimeAsync(0)
    expect(fullscreen.state.value).toBe('closed')
    expect(readSession(context.pageId)).toBeNull()
    expect(readSessionDisconnectRequest(context.pageId)?.token).toBe(handoff.token)
    window.dispatchEvent(new StorageEvent('storage', { key: `agentLinkDisconnectRequest:${context.pageId}` }))
    expect(owner.state.value).toBe('closed')
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(ownerRevoke).not.toHaveBeenCalled()
    expect(revokeAgentLinkSession).toHaveBeenCalledTimes(1)
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'agent_link_disconnected')).toHaveLength(1)
  })

  it('keeps a failed revocation retryable without claiming that the agent disconnected', async () => {
    persistSession(handoff)
    const fullscreen = useAgentLinkSession(bridge(), { macroType: 'sequence' })
    fullscreen.hydrateFrom(handoff)
    vi.mocked(revokeAgentLinkSession).mockRejectedValueOnce(new Error('offline'))
    fullscreen.disconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(fullscreen.state.value).toBe('recovery_exhausted')
    expect(fullscreen.noticeReason.value).toBe('disconnect_failed')
    expect(fullscreen.token.value).toBe(handoff.token)
    expect(readSession(context.pageId)?.token).toBe(handoff.token)
    expect(readSessionDisconnectRequest(context.pageId)).toBeNull()
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('agent_link_disconnected', expect.anything())

    fullscreen.disconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(revokeAgentLinkSession).toHaveBeenCalledTimes(2)
    expect(fullscreen.state.value).toBe('closed')
    expect(readSession(context.pageId)).toBeNull()
  })

  it('does not close or clear a newer session when an older revocation finishes late', async () => {
    persistSession(handoff)
    const fullscreen = useAgentLinkSession(bridge(), { macroType: 'sequence' })
    fullscreen.hydrateFrom(handoff)
    let confirm!: () => void
    vi.mocked(revokeAgentLinkSession).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve }))
    fullscreen.disconnect()
    fullscreen.token.value = 'new-token'
    fullscreen.state.value = 'connected'
    persistSession({ ...handoff, token: 'new-token' })
    confirm()
    await vi.advanceTimersByTimeAsync(0)
    expect(fullscreen.state.value).toBe('connected')
    expect(readSession(context.pageId)?.token).toBe('new-token')
  })
})
