import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

// Only exercised by the "relay wiring" describe block below (real callers
// pass relayOptions.connect, so agentLinkWsUrl runs for real there too) —
// stubbed here purely so that path doesn't need a live forgeGlobal context.
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { zenumlRemoteBaseUrl: 'https://backend.example' },
}))

import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { useAgentLinkSession } from './useAgentLinkSession'
import { SETUP_TIMEOUT_MS } from './agentLinkState'
import type { AgentLinkBridgeOps } from './bridgeOps'

function makeBridgeOps(
  overrides: Partial<AgentLinkBridgeOps> = {}
): AgentLinkBridgeOps {
  return {
    readPage: vi.fn().mockResolvedValue({ pageId: 'p1', title: 't', text: 'body' }),
    readDiagram: vi
      .fn()
      .mockResolvedValue({ contentId: 'c1', diagramType: 'sequence', dsl: 'A->B' }),
    writeDiagram: vi.fn().mockResolvedValue({ ok: true, version: 1, rendered: true }),
    ...overrides,
  }
}

describe('useAgentLinkSession', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('startConnect moves idle -> waiting and fires agent_link_connect_clicked', () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()

    expect(session.state.value).toBe('waiting')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_connect_clicked',
      expect.objectContaining({ feature_area: 'agent_link', macro_type: 'sequence' })
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_session_created',
      expect.objectContaining({ macro_type: 'sequence' })
    )
  })

  it('a repeat startConnect click while already waiting does not re-mint a session', () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    const tokenAfterFirst = session.token.value
    vi.mocked(trackAnalyticsEvent).mockClear()

    session.startConnect()
    expect(session.state.value).toBe('waiting')
    expect(session.token.value).toBe(tokenAfterFirst)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_connect_clicked',
      expect.anything()
    )
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'agent_link_session_created',
      expect.anything()
    )
  })

  it('onAgentConnected moves waiting -> connected and fires agent_link_agent_connected', () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'mermaid' })
    session.startConnect()
    vi.mocked(trackAnalyticsEvent).mockClear()

    session.onAgentConnected()

    expect(session.state.value).toBe('connected')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_agent_connected',
      expect.objectContaining({
        macro_type: 'mermaid',
        time_to_connect_ms: expect.any(Number),
      })
    )
  })

  it('onAgentConnected before startConnect (idle) is a no-op', () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

    session.onAgentConnected()

    expect(session.state.value).toBe('idle')
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'agent_link_agent_connected',
      expect.anything()
    )
  })

  it('applyEdit success pushes a feed entry and fires agent_link_edit_applied', async () => {
    const bridgeOps = makeBridgeOps({
      writeDiagram: vi.fn().mockResolvedValue({ ok: true, version: 3, rendered: true }),
    })
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    session.onAgentConnected()
    vi.mocked(trackAnalyticsEvent).mockClear()

    const result = await session.applyEdit('A->B: hi', 'added a step')

    expect(result.ok).toBe(true)
    expect(bridgeOps.writeDiagram).toHaveBeenCalledWith('A->B: hi', 'added a step')
    expect(session.activityFeed.value).toHaveLength(1)
    expect(session.activityFeed.value[0]).toMatchObject({ summary: 'added a step' })
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_edit_applied',
      expect.objectContaining({
        macro_type: 'sequence',
        render_ok: true,
        dsl_len_delta: 'A->B: hi'.length,
      })
    )
  })

  it('applyEdit with no summary falls back to a generic feed entry', async () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    session.onAgentConnected()

    await session.applyEdit('A->B: hi')

    expect(session.activityFeed.value[0]).toMatchObject({ summary: 'diagram updated' })
  })

  it('applyEdit failure fires agent_link_edit_failed and does not touch the feed', async () => {
    const bridgeOps = makeBridgeOps({
      writeDiagram: vi.fn().mockResolvedValue({ ok: false, reason: 'version_conflict' }),
    })
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    session.onAgentConnected()
    vi.mocked(trackAnalyticsEvent).mockClear()

    const result = await session.applyEdit('A->B: hi')

    expect(result.ok).toBe(false)
    expect(session.activityFeed.value).toHaveLength(0)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_edit_failed',
      expect.objectContaining({ macro_type: 'sequence', reason: 'version_conflict' })
    )
  })

  describe('relay wiring — live-render callback (agent-link render fix)', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), getState: vi.fn(() => 'open') }
    }

    it('threads onDiagramUpdated through relay.connect and forwards it to options.onDiagramUpdated with macroType', async () => {
      const bridgeOps = makeBridgeOps()
      const onDiagramUpdated = vi.fn()
      let capturedOnDiagramUpdated: ((dsl: string) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, _onStateEvent, onDiagUpdated) => {
        capturedOnDiagramUpdated = onDiagUpdated
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'mermaid',
        onDiagramUpdated,
        relay: {
          boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' },
          requestSession,
          connect,
        },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      expect(connect).toHaveBeenCalledTimes(1)
      expect(typeof capturedOnDiagramUpdated).toBe('function')

      capturedOnDiagramUpdated!('graph TD; A-->B')

      expect(onDiagramUpdated).toHaveBeenCalledWith('graph TD; A-->B', 'mermaid')
    })

    it('does not throw when the relay fires the callback and no options.onDiagramUpdated was supplied', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnDiagramUpdated: ((dsl: string) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, _onStateEvent, onDiagUpdated) => {
        capturedOnDiagramUpdated = onDiagUpdated
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: {
          boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' },
          requestSession,
          connect,
        },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      expect(() => capturedOnDiagramUpdated!('A->B: hi')).not.toThrow()
    })
  })

  describe('relay wiring — relay-driven edits populate the activity feed + fire analytics (the gap this fix closes)', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), getState: vi.fn(() => 'open') }
    }

    it('a successful relay-driven update_diagram op pushes a feed entry and fires agent_link_edit_applied', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnEditApplied: ((outcome: any) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, _onStateEvent, _onDiagUpdated, onEditApplied) => {
        capturedOnEditApplied = onEditApplied
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: {
          boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' },
          requestSession,
          connect,
        },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()

      expect(typeof capturedOnEditApplied).toBe('function')
      capturedOnEditApplied!({
        ok: true,
        dsl: 'A->B: hi',
        summary: 'agent added a step',
        rendered: true,
      })

      expect(session.activityFeed.value).toHaveLength(1)
      expect(session.activityFeed.value[0]).toMatchObject({ summary: 'agent added a step' })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_edit_applied',
        expect.objectContaining({
          macro_type: 'sequence',
          render_ok: true,
          dsl_len_delta: 'A->B: hi'.length,
        })
      )
    })

    it('a failing relay-driven update_diagram op fires agent_link_edit_failed and does not touch the feed', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnEditApplied: ((outcome: any) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, _onStateEvent, _onDiagUpdated, onEditApplied) => {
        capturedOnEditApplied = onEditApplied
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: {
          boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' },
          requestSession,
          connect,
        },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()

      capturedOnEditApplied!({ ok: false, dsl: 'A->B: hi', reason: 'version_conflict' })

      expect(session.activityFeed.value).toHaveLength(0)
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_edit_failed',
        expect.objectContaining({ macro_type: 'sequence', reason: 'version_conflict' })
      )
    })

    it('a relay-driven edit does not fire analytics twice — one op, one edit_applied call', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnEditApplied: ((outcome: any) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, _onStateEvent, _onDiagUpdated, onEditApplied) => {
        capturedOnEditApplied = onEditApplied
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: {
          boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' },
          requestSession,
          connect,
        },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()

      capturedOnEditApplied!({ ok: true, dsl: 'A->B: hi', summary: 'x', rendered: true })

      const editAppliedCalls = vi
        .mocked(trackAnalyticsEvent)
        .mock.calls.filter(([name]) => name === 'agent_link_edit_applied')
      expect(editAppliedCalls).toHaveLength(1)
      // bridgeOps.writeDiagram (the applyEdit() seam) was never called by the
      // relay path — only the relay's own bridge (passed straight to
      // createRelayClient / a fake connect here) performs the write.
      expect(bridgeOps.writeDiagram).not.toHaveBeenCalled()
    })
  })

  it('the 20s setup timeout moves waiting -> timeout and fires agent_link_setup_shown', async () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    expect(session.state.value).toBe('waiting')
    vi.mocked(trackAnalyticsEvent).mockClear()

    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)

    expect(session.state.value).toBe('timeout')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_setup_shown',
      expect.objectContaining({ macro_type: 'sequence' })
    )
  })

  it('the setup timeout is a no-op if the agent already connected first', async () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    session.onAgentConnected()
    vi.mocked(trackAnalyticsEvent).mockClear()

    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)

    expect(session.state.value).toBe('connected')
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'agent_link_setup_shown',
      expect.anything()
    )
  })

  it('the agent can still connect after timeout (timeout -> connected)', async () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)
    expect(session.state.value).toBe('timeout')

    session.onAgentConnected()

    expect(session.state.value).toBe('connected')
  })

  it('disconnect closes the session and fires agent_link_disconnected with edits_count', async () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    session.onAgentConnected()
    await session.applyEdit('A->B: hi')
    vi.mocked(trackAnalyticsEvent).mockClear()

    session.disconnect('user')

    expect(session.state.value).toBe('closed')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_disconnected',
      expect.objectContaining({
        macro_type: 'sequence',
        reason: 'user',
        edits_count: 1,
        session_duration_ms: expect.any(Number),
      })
    )
  })

  it('disconnect while idle is a no-op — nothing to disconnect', () => {
    const bridgeOps = makeBridgeOps()
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

    session.disconnect('user')

    expect(session.state.value).toBe('idle')
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'agent_link_disconnected',
      expect.anything()
    )
  })
})
