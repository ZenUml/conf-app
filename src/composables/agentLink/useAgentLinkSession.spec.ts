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
import { readSession, persistSession } from './sessionHandoff'
import type { AgentLinkHandoffSession } from './sessionHandoff'

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
    localStorage.clear()
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

    it('republishes the dsl onto the handoff record when a relay-driven update_diagram fires (Fullscreen live-render)', async () => {
      const bridgeOps = makeBridgeOps()
      const boundContext = { cloudId: 'c1', pageId: 'page-relay-dsl', contentId: 'cc1' }
      let capturedOnDiagramUpdated: ((dsl: string) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, _onStateEvent, onDiagUpdated) => {
        capturedOnDiagramUpdated = onDiagUpdated
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token-dsl' })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'mermaid',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      capturedOnDiagramUpdated!('graph TD; A-->B')

      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token-dsl',
        state: 'connected',
        dsl: 'graph TD; A-->B',
      })
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

    it('marks the session connected on the first relay op and does not re-fire analytics on later ops', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnStateEvent: ((event: any) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, onStateEvent) => {
        capturedOnStateEvent = onStateEvent
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })
      const boundContext = { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' }

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      expect(session.state.value).toBe('waiting')
      vi.mocked(trackAnalyticsEvent).mockClear()

      capturedOnStateEvent!({ type: 'op', op: 'read_page' })

      expect(session.state.value).toBe('connected')
      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token',
        state: 'connected',
      })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_agent_connected',
        expect.objectContaining({ macro_type: 'sequence' })
      )

      capturedOnStateEvent!({ type: 'op', op: 'read_diagram' })

      const connectedCalls = vi
        .mocked(trackAnalyticsEvent)
        .mock.calls.filter(([name]) => name === 'agent_link_agent_connected')
      expect(connectedCalls).toHaveLength(1)
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

  // Cross-iframe handoff (finding #3, manual test 2026-07-08): Fullscreen
  // boots as a SEPARATE useAgentLinkSession() instance from the inline
  // macro's (see GenericViewer.vue's connectToAgent() comment), so it never
  // saw the token this instance minted. These tests cover the INLINE side of
  // the fix — persisting the token/state so sessionHandoff.readSession() can
  // find it. See sessionHandoff.spec.ts for the storage layer itself, and
  // 'hydrateFrom' below for the Fullscreen side.
  describe('session handoff — the inline instance persists its token for Fullscreen to pick up', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), getState: vi.fn(() => 'open') }
    }
    const boundContext = { cloudId: 'c1', pageId: 'page-99', contentId: 'cc1' }

    it('persists the real token (state: waiting) once the relay mint resolves', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token-1' })
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })

      session.startConnect()
      // Before the mint resolves, nothing has been persisted yet — only the
      // real, relay-minted token is ever written (see the comment at the
      // persistSession call site in useAgentLinkSession.ts).
      expect(readSession(boundContext.pageId)).toBeNull()

      await vi.advanceTimersByTimeAsync(0)

      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token-1',
        state: 'waiting',
      })
    })

    it('never persists anything for the unwired placeholder instance (no relay option)', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      session.startConnect()

      expect(localStorage.length).toBe(0)
    })

    it('onAgentConnected re-persists the record with state: connected', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token-2' })
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      session.onAgentConnected()

      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token-2',
        state: 'connected',
      })
    })

    it('disconnect clears the persisted handoff record', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token-3' })
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      expect(readSession(boundContext.pageId)).not.toBeNull()

      session.disconnect('user')

      expect(readSession(boundContext.pageId)).toBeNull()
    })
  })

  describe('hydrateFrom — Fullscreen-side hydration of a session persisted elsewhere', () => {
    function makeHandoff(overrides: Partial<AgentLinkHandoffSession> = {}): AgentLinkHandoffSession {
      return {
        token: 'handed-off-token',
        cloudId: 'c1',
        pageId: 'page-1',
        contentId: 'cc1',
        state: 'waiting',
        ...overrides,
      }
    }

    it('hydrates an idle instance into waiting with the handed-off token, without minting or connecting', () => {
      const bridgeOps = makeBridgeOps()
      const requestSession = vi.fn()
      const connect = vi.fn()
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: {
          boundContext: { cloudId: 'c1', pageId: 'page-1', contentId: 'cc1' },
          requestSession,
          connect,
        },
      })

      session.hydrateFrom(makeHandoff({ state: 'waiting' }))

      expect(session.state.value).toBe('waiting')
      expect(session.token.value).toBe('handed-off-token')
      expect(requestSession).not.toHaveBeenCalled()
      expect(connect).not.toHaveBeenCalled()
    })

    it('hydrates directly into connected when the persisted session is already connected', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      session.hydrateFrom(makeHandoff({ state: 'connected' }))

      expect(session.state.value).toBe('connected')
      expect(session.token.value).toBe('handed-off-token')
    })

    it('is a no-op on a non-idle instance — never clobbers a session this instance is itself driving', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      session.startConnect()
      const tokenBeforeHydrate = session.token.value

      session.hydrateFrom(makeHandoff({ token: 'other-token' }))

      expect(session.token.value).toBe(tokenBeforeHydrate)
      expect(session.state.value).toBe('waiting')
    })

    // dsl application (Fullscreen live-render): hydrateFrom's dsl handling is
    // independent of — and not early-returned past by — the state-adoption
    // branch above, since a Fullscreen opened AFTER edits already happened
    // still needs the latest dsl applied on the very hydrate that adopts the
    // token/state.
    it('applies dsl via onDiagramUpdated when hydrating from idle (Fullscreen opened after edits already happened)', () => {
      const bridgeOps = makeBridgeOps()
      const onDiagramUpdated = vi.fn()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence', onDiagramUpdated })

      session.hydrateFrom(makeHandoff({ state: 'connected', dsl: 'A->B: hi' }))

      expect(session.state.value).toBe('connected')
      expect(session.token.value).toBe('handed-off-token')
      expect(onDiagramUpdated).toHaveBeenCalledTimes(1)
      expect(onDiagramUpdated).toHaveBeenCalledWith('A->B: hi', 'sequence')
    })

    it('applies a later dsl-only update while already connected, without re-adopting state or re-firing analytics', () => {
      const bridgeOps = makeBridgeOps()
      const onDiagramUpdated = vi.fn()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence', onDiagramUpdated })

      session.hydrateFrom(makeHandoff({ state: 'connected' }))
      expect(session.state.value).toBe('connected')
      onDiagramUpdated.mockClear()

      session.hydrateFrom(makeHandoff({ state: 'connected', dsl: 'A->B: hi' }))

      expect(session.state.value).toBe('connected')
      expect(onDiagramUpdated).toHaveBeenCalledTimes(1)
      expect(onDiagramUpdated).toHaveBeenCalledWith('A->B: hi', 'sequence')
    })

    it('calling hydrateFrom twice with the same dsl only calls onDiagramUpdated once (lastHydratedDsl dedup)', () => {
      const bridgeOps = makeBridgeOps()
      const onDiagramUpdated = vi.fn()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence', onDiagramUpdated })

      session.hydrateFrom(makeHandoff({ state: 'connected', dsl: 'A->B: hi' }))
      session.hydrateFrom(makeHandoff({ state: 'connected', dsl: 'A->B: hi' }))

      expect(onDiagramUpdated).toHaveBeenCalledTimes(1)
    })

    it('does not call onDiagramUpdated when the handoff record has no dsl field', () => {
      const bridgeOps = makeBridgeOps()
      const onDiagramUpdated = vi.fn()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence', onDiagramUpdated })

      session.hydrateFrom(makeHandoff({ state: 'waiting' }))

      expect(onDiagramUpdated).not.toHaveBeenCalled()
    })
  })

  // Reactive Fullscreen hydration (mint-vs-mount RACE, 2026-07-09 live
  // spot-check): GenericViewer.vue's mounted() calls readSession() once and,
  // if it finds nothing yet, falls back to watchForHandoff() — this proves
  // the fallback actually hydrates once the inline instance's persistSession()
  // call lands, via the same-origin `storage` event AND the poll fallback,
  // and that it's a no-op once no longer idle / after unsubscribe.
  describe('watchForHandoff — reactive counterpart to the one-shot readSession()+hydrateFrom()', () => {
    function makeHandoff(overrides: Partial<AgentLinkHandoffSession> = {}): AgentLinkHandoffSession {
      return {
        token: 'handed-off-token',
        cloudId: 'c1',
        pageId: 'page-1',
        contentId: 'cc1',
        state: 'waiting',
        ...overrides,
      }
    }

    it('hydrates into waiting when another document fires a storage event for this pageId', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      const unsubscribe = session.watchForHandoff('page-1')
      expect(session.state.value).toBe('idle')

      // The inline instance's startConnect().then(...) resolving, landing a
      // real token in localStorage a moment after this instance mounted.
      persistSession(makeHandoff())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))

      expect(session.state.value).toBe('waiting')
      expect(session.token.value).toBe('handed-off-token')
      unsubscribe()
    })

    it('updates an already-hydrated waiting Fullscreen session when the relay owner persists connected', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      const unsubscribe = session.watchForHandoff('page-1')
      persistSession(makeHandoff({ state: 'waiting' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(session.state.value).toBe('waiting')
      vi.mocked(trackAnalyticsEvent).mockClear()

      persistSession(makeHandoff({ state: 'connected' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))

      expect(session.state.value).toBe('connected')
      expect(session.token.value).toBe('handed-off-token')
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
        'agent_link_agent_connected',
        expect.anything()
      )
      unsubscribe()
    })

    it('falls back to the bounded poll when the storage event is missed', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      const unsubscribe = session.watchForHandoff('page-1')
      persistSession(makeHandoff())
      // No storage event dispatched — the default 400ms poll tick must still find it.
      vi.advanceTimersByTime(400)

      expect(session.state.value).toBe('waiting')
      expect(session.token.value).toBe('handed-off-token')
      unsubscribe()
    })

    it('does not hydrate once this instance is no longer idle (guarded by hydrateFrom)', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      const unsubscribe = session.watchForHandoff('page-1')

      // This instance starts its OWN connection before the watched session appears.
      session.startConnect()
      const tokenAfterOwnConnect = session.token.value

      persistSession(makeHandoff({ token: 'other-token' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))

      expect(session.token.value).toBe(tokenAfterOwnConnect)
      unsubscribe()
    })

    it('the returned unsubscribe function stops both the storage listener and the poll', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      const unsubscribe = session.watchForHandoff('page-1')

      unsubscribe()
      persistSession(makeHandoff())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      vi.advanceTimersByTime(8000)

      expect(session.state.value).toBe('idle')
      expect(session.token.value).toBeNull()
    })
  })

  // pageId-less Fullscreen fallback (finding #4, 2026-07-09 live spot-check):
  // a Fullscreen mount that never resolved a boundContext.pageId (no
  // apWrapper/Forge-bridge context) can't call watchForHandoff(pageId) — it
  // has no pageId to scope to. watchForAnyHandoff() covers that by matching
  // ANY agentLinkSession:* record via subscribeToAnyHandoff(), same
  // hydrateFrom() guard, same unsubscribe contract.
  describe('watchForAnyHandoff — pageId-less counterpart to watchForHandoff', () => {
    function makeHandoff(overrides: Partial<AgentLinkHandoffSession> = {}): AgentLinkHandoffSession {
      return {
        token: 'handed-off-token',
        cloudId: 'c1',
        pageId: 'page-unknown',
        contentId: 'cc1',
        state: 'waiting',
        ...overrides,
      }
    }

    it('hydrates into waiting when ANY session appears via a storage event', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      const unsubscribe = session.watchForAnyHandoff()
      expect(session.state.value).toBe('idle')

      persistSession(makeHandoff())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-unknown' }))

      expect(session.state.value).toBe('waiting')
      expect(session.token.value).toBe('handed-off-token')
      unsubscribe()
    })

    it('falls back to the bounded poll when the storage event is missed', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      const unsubscribe = session.watchForAnyHandoff()
      persistSession(makeHandoff())
      vi.advanceTimersByTime(400)

      expect(session.state.value).toBe('waiting')
      expect(session.token.value).toBe('handed-off-token')
      unsubscribe()
    })

    it('does not hydrate once this instance is no longer idle', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      const unsubscribe = session.watchForAnyHandoff()

      session.startConnect()
      const tokenAfterOwnConnect = session.token.value

      persistSession(makeHandoff({ token: 'other-token' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-unknown' }))

      expect(session.token.value).toBe(tokenAfterOwnConnect)
      unsubscribe()
    })

    it('the returned unsubscribe function stops both the storage listener and the poll', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      const unsubscribe = session.watchForAnyHandoff()

      unsubscribe()
      persistSession(makeHandoff())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-unknown' }))
      vi.advanceTimersByTime(8000)

      expect(session.state.value).toBe('idle')
      expect(session.token.value).toBeNull()
    })
  })
})
