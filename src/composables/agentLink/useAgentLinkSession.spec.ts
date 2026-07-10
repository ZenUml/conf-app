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
import { useAgentLinkSession, ERROR_FLASH_MS } from './useAgentLinkSession'
import { SETUP_TIMEOUT_MS, RENDER_SAFETY_TIMEOUT_MS } from './agentLinkState'
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
    searchDiagrams: vi.fn().mockResolvedValue([]),
    listDiagrams: vi.fn().mockResolvedValue([]),
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

  it('applyEdit failure fires agent_link_edit_failed and adds a visible error cue to the feed (Track F)', async () => {
    const bridgeOps = makeBridgeOps({
      writeDiagram: vi.fn().mockResolvedValue({ ok: false, reason: 'version_conflict' }),
    })
    const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
    session.startConnect()
    session.onAgentConnected()
    vi.mocked(trackAnalyticsEvent).mockClear()

    const result = await session.applyEdit('A->B: hi')

    expect(result.ok).toBe(false)
    // Charter §6 failure path: a failed edit must leave a visible error cue in
    // the feed (was: silently no feed entry). Exactly one error line.
    expect(session.activityFeed.value).toHaveLength(1)
    expect(session.activityFeed.value[0].summary).toMatch(/did not apply/i)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'agent_link_edit_failed',
      expect.objectContaining({ macro_type: 'sequence', reason: 'version_conflict' })
    )
  })

  describe('relay wiring — live-render callback (agent-link render fix)', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: vi.fn(() => 'open') }
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

      // bug 2 fix (spot-check #3, 2026-07-09): every handoff write now also
      // carries `feed` (bounded activity-feed snapshot, `[]` here since
      // nothing was pushed to activityFeed before this dsl republish) — the
      // record is no longer byte-identical to the pre-fix shape, which is the
      // whole point of the fix (Fullscreen's rail previously had nothing to
      // hydrate its TTL meter / discovery rows from).
      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token-dsl',
        state: 'connected',
        dsl: 'graph TD; A-->B',
        feed: [],
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
      // bug 2 fix: `feed` now travels on every handoff write (see the dsl
      // republish test above for why this is deliberate, not a regression).
      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token',
        state: 'connected',
        feed: [],
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

    it('mint 409 diagram_already_linked moves to already_linked, publishes the rejected handoff, and fires analytics', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const boundContext = { cloudId: 'c1', pageId: 'already-linked-page', contentId: 'cc1' }
      const requestSession = vi.fn().mockRejectedValue(
        Object.assign(new Error('agent-link session mint failed: HTTP 409 diagram_already_linked'), {
          status: 409,
          error: 'diagram_already_linked',
        })
      )

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      expect(session.state.value).toBe('already_linked')
      expect(session.token.value).toBeNull()
      expect(connect).not.toHaveBeenCalled()
      expect(readSession(boundContext.pageId)).toMatchObject({
        ...boundContext,
        state: 'already_linked',
      })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_edit_failed',
        expect.objectContaining({
          macro_type: 'sequence',
          reason: 'diagram_already_linked',
          error_code: 'diagram_already_linked',
        })
      )
    })

    it('generic mint failure moves to failed, publishes a visible failure handoff, and fires analytics', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const boundContext = { cloudId: 'c1', pageId: 'mint-failed-page', contentId: 'cc1' }
      const requestSession = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('agent-link session mint failed: HTTP 500'), { status: 500 }))

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'mermaid',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      expect(session.state.value).toBe('failed')
      expect(session.token.value).toBeNull()
      expect(connect).not.toHaveBeenCalled()
      expect(readSession(boundContext.pageId)).toMatchObject({
        ...boundContext,
        state: 'failed',
      })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_edit_failed',
        expect.objectContaining({
          macro_type: 'mermaid',
          reason: 'session_mint_failed',
          error_code: 'session_mint_failed',
        })
      )
    })
  })

  describe('Track G — session lifecycle: suspend on an accidental ws drop, resume on reconnect', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: vi.fn(() => 'open') }
    }

    async function connectedSession() {
      const bridgeOps = makeBridgeOps()
      let capturedOnStateEvent: ((event: any) => void) | undefined
      const fakeClient = makeFakeRelayClient()
      const connect = vi.fn((_wsUrl, _bridge, onStateEvent) => {
        capturedOnStateEvent = onStateEvent
        return fakeClient
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })
      const boundContext = { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' }

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      capturedOnStateEvent!({ type: 'op', op: 'read_page' }) // -> connected
      vi.mocked(trackAnalyticsEvent).mockClear()

      return { session, boundContext, fakeClient, emit: () => capturedOnStateEvent! }
    }

    it('an unexpected close while connected suspends, feeds "Connection paused", and fires agent_link_session_suspended', async () => {
      const { session, boundContext, emit } = await connectedSession()

      emit()({ type: 'close', code: 1006, wasClean: false })

      expect(session.state.value).toBe('suspended')
      expect(session.activityFeed.value.at(-1)?.summary).toBe('Connection paused')
      expect(readSession(boundContext.pageId)).toMatchObject({ state: 'suspended' })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_session_suspended',
        expect.objectContaining({ macro_type: 'sequence', reason: 'ws_drop' })
      )
    })

    it('a reconnect (open) while suspended resumes, feeds "Reconnected", and fires agent_link_session_resumed with latency', async () => {
      const { session, boundContext, emit } = await connectedSession()
      emit()({ type: 'close' })
      expect(session.state.value).toBe('suspended')
      vi.mocked(trackAnalyticsEvent).mockClear()

      await vi.advanceTimersByTimeAsync(1500)
      emit()({ type: 'open' })

      expect(session.state.value).toBe('connected')
      expect(session.activityFeed.value.at(-1)?.summary).toBe('Reconnected · resumed session')
      expect(readSession(boundContext.pageId)).toMatchObject({ state: 'connected' })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_session_resumed',
        expect.objectContaining({ macro_type: 'sequence', resume_latency_ms: expect.any(Number) })
      )
      const [, props] = vi
        .mocked(trackAnalyticsEvent)
        .mock.calls.find(([name]) => name === 'agent_link_session_resumed')!
      expect((props as any).resume_latency_ms).toBeGreaterThanOrEqual(1500)
    })

    it('a close while only "waiting" (agent never paired) does not suspend — no meaningful interruption yet', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnStateEvent: ((event: any) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, onStateEvent) => {
        capturedOnStateEvent = onStateEvent
        return makeFakeRelayClient()
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' }, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      capturedOnStateEvent!({ type: 'close' })

      expect(session.state.value).toBe('waiting')
    })

    it('an explicit disconnect() while suspended sends the wire disconnect and moves to closed', async () => {
      const { session, fakeClient, emit } = await connectedSession()
      emit()({ type: 'close' })
      expect(session.state.value).toBe('suspended')

      session.disconnect('user')

      expect(session.state.value).toBe('closed')
      expect(fakeClient.disconnect).toHaveBeenCalledTimes(1)
      expect(fakeClient.close).not.toHaveBeenCalled()
    })

    it('disconnect() while connected calls relayClient.disconnect() (explicit), not close() (accidental)', async () => {
      const { session, fakeClient } = await connectedSession()

      session.disconnect('user')

      expect(fakeClient.disconnect).toHaveBeenCalledTimes(1)
      expect(fakeClient.close).not.toHaveBeenCalled()
    })

    it('revokeAndRelink() disconnects the current session and immediately mints a fresh one', async () => {
      const bridgeOps = makeBridgeOps()
      const fakeClient1 = makeFakeRelayClient()
      const fakeClient2 = makeFakeRelayClient()
      let callCount = 0
      const connect = vi.fn(() => (++callCount === 1 ? fakeClient1 : fakeClient2))
      const requestSession = vi
        .fn()
        .mockResolvedValueOnce({ token: 'token-1' })
        .mockResolvedValueOnce({ token: 'token-2' })
      const boundContext = { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' }

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      expect(session.token.value).toBe('token-1')

      session.revokeAndRelink()
      await vi.advanceTimersByTimeAsync(0)

      expect(fakeClient1.disconnect).toHaveBeenCalledTimes(1)
      expect(session.state.value).toBe('waiting')
      expect(session.token.value).toBe('token-2')
      expect(requestSession).toHaveBeenCalledTimes(2)
    })

    describe('attemptReattach — a fresh (reloaded) inline mount reattaches by the SAME persisted token', () => {
      const boundContext = { cloudId: 'c1', pageId: 'reload-page', contentId: 'cc1' }

      it('reattaches directly into "connected" using the persisted token — no re-mint, no requestSession call', async () => {
        persistSession({ ...boundContext, token: 'persisted-token', state: 'connected' })
        const bridgeOps = makeBridgeOps()
        const fakeClient = makeFakeRelayClient()
        const connect = vi.fn(() => fakeClient)
        const requestSession = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext, requestSession, connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('connected')
        expect(session.token.value).toBe('persisted-token')
        expect(requestSession).not.toHaveBeenCalled()
        expect(connect).toHaveBeenCalledTimes(1)
        expect(connect.mock.calls[0][0]).toContain('token=persisted-token')
      })

      it('reattaches a "suspended" persisted record the same way (also lands on "connected" pending the new socket)', async () => {
        persistSession({ ...boundContext, token: 'persisted-token', state: 'suspended' })
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn(() => makeFakeRelayClient())
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext, requestSession: vi.fn(), connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('connected')
        expect(session.token.value).toBe('persisted-token')
      })

      it('is a no-op when nothing was persisted for this pageId', () => {
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext: { ...boundContext, pageId: 'no-such-page' }, requestSession: vi.fn(), connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('idle')
        expect(connect).not.toHaveBeenCalled()
      })

      it('is a no-op for a "waiting"-only persisted record (agent never paired — nothing to resume)', () => {
        persistSession({ ...boundContext, token: 'persisted-token', state: 'waiting' })
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext, requestSession: vi.fn(), connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('idle')
        expect(connect).not.toHaveBeenCalled()
      })

      it('is a no-op when the instance is no longer idle (never clobbers a session already being driven)', () => {
        persistSession({ ...boundContext, token: 'persisted-token', state: 'connected' })
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext, requestSession: vi.fn().mockResolvedValue({ token: 'other-token' }), connect },
        })
        session.startConnect() // -> waiting, no longer idle

        session.attemptReattach()

        expect(connect).not.toHaveBeenCalled()
      })

      it('applies the persisted dsl (if any) so the reattached surface shows the last-known diagram', () => {
        persistSession({ ...boundContext, token: 'persisted-token', state: 'connected', dsl: 'A->B: hi' })
        const bridgeOps = makeBridgeOps()
        const onDiagramUpdated = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          onDiagramUpdated,
          relay: { boundContext, requestSession: vi.fn(), connect: vi.fn(() => makeFakeRelayClient()) },
        })

        session.attemptReattach()

        // attemptReattach seeds lastAppliedDsl locally (for dsl_len_delta
        // bookkeeping) but does NOT itself call onDiagramUpdated — the
        // diagram is already rendered from the pre-reload state; only a
        // NEW agent edit over the reattached socket should trigger a redraw.
        expect(onDiagramUpdated).not.toHaveBeenCalled()
        expect(session.state.value).toBe('connected')
      })
    })
  })

  // #314 — the relay correctly 403s the agent once the minted token's TTL
  // (TOKEN_TTL_MS = 10 min) lapses, but nothing previously watched
  // `expiresAt` against the clock, so the rail stayed stuck showing a
  // connected variant with the countdown pinned at "0:00" forever. These
  // tests drive the fix's client-side TTL watchdog (scheduleExpiry() /
  // handleExpired()) using the SAME fake-timer harness as the rest of this
  // file (global vi.useFakeTimers() from the outer beforeEach — advancing it
  // also advances Date.now(), which is what the composable's default `now()`
  // reads).
  describe('#314 — client-side TTL watchdog expires a stale session', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: vi.fn(() => 'open') }
    }
    const TOKEN_TTL_MS = 10 * 60 * 1000
    const boundContext = { cloudId: 'c1', pageId: 'ttl-page', contentId: 'cc1' }

    it('a connected session moves to expired when the token TTL lapses, tears down the relay (not disconnect()), persists the expired handoff, and fires agent_link_session_expired', async () => {
      const bridgeOps = makeBridgeOps()
      const fakeClient = makeFakeRelayClient()
      let capturedOnStateEvent: ((event: any) => void) | undefined
      const connect = vi.fn((_wsUrl, _bridge, onStateEvent) => {
        capturedOnStateEvent = onStateEvent
        return fakeClient
      })
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token', expiresInSec: TOKEN_TTL_MS / 1000 })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0) // resolve the mint -> waiting, expiresAt set, watchdog armed
      capturedOnStateEvent!({ type: 'op', op: 'read_page' }) // -> connected
      await session.applyEdit('A->B: hi') // edits_count should reach 1 in the terminal event
      vi.mocked(trackAnalyticsEvent).mockClear()

      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS)

      expect(session.state.value).toBe('expired')
      // Teardown uses close() (no wire disconnect envelope needed — the token
      // is already dead server-side), never the explicit disconnect() path.
      expect(fakeClient.close).toHaveBeenCalledTimes(1)
      expect(fakeClient.disconnect).not.toHaveBeenCalled()
      expect(readSession(boundContext.pageId)).toMatchObject({ state: 'expired' })
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_session_expired',
        expect.objectContaining({
          feature_area: 'agent_link',
          macro_type: 'sequence',
          had_agent_connected: true,
          session_duration_ms: expect.any(Number),
          edits_count: 1,
        })
      )
    })

    it('a session still "waiting" (agent never paired) also expires on TTL lapse, with had_agent_connected: false', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token', expiresInSec: TOKEN_TTL_MS / 1000 })

      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext: { ...boundContext, pageId: 'ttl-page-waiting' }, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      expect(session.state.value).toBe('waiting')
      vi.mocked(trackAnalyticsEvent).mockClear()

      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS)

      expect(session.state.value).toBe('expired')
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_session_expired',
        expect.objectContaining({ had_agent_connected: false })
      )
    })

    it('disconnect() before the TTL lapses clears the scheduled watchdog — no expired event fires later', async () => {
      const bridgeOps = makeBridgeOps()
      const connect = vi.fn(() => makeFakeRelayClient())
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token', expiresInSec: TOKEN_TTL_MS / 1000 })
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext: { ...boundContext, pageId: 'ttl-page-disconnect' }, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      session.disconnect('user')
      vi.mocked(trackAnalyticsEvent).mockClear()

      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS)

      expect(session.state.value).toBe('closed')
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
        'agent_link_session_expired',
        expect.anything()
      )
    })

    describe('attemptReattach — a reload must never resurrect a dead token', () => {
      it('lands directly on "expired" when the persisted record itself already says expired', () => {
        const pageId = 'ttl-reattach-expired-state'
        persistSession({ cloudId: 'c1', pageId, contentId: 'cc1', token: 'dead-token', state: 'expired' })
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext: { cloudId: 'c1', pageId, contentId: 'cc1' }, requestSession: vi.fn(), connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('expired')
        expect(session.token.value).toBe('dead-token')
        expect(connect).not.toHaveBeenCalled()
      })

      it('lands directly on "expired" when a persisted "connected" record\'s expiresAt has already lapsed', () => {
        const pageId = 'ttl-reattach-lapsed-expiry'
        persistSession({
          cloudId: 'c1',
          pageId,
          contentId: 'cc1',
          token: 'dead-token',
          state: 'connected',
          expiresAt: Date.now() - 1000,
        })
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn()
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext: { cloudId: 'c1', pageId, contentId: 'cc1' }, requestSession: vi.fn(), connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('expired')
        expect(connect).not.toHaveBeenCalled()
      })

      it('still reattaches normally into "connected" when the persisted expiresAt has NOT lapsed', () => {
        const pageId = 'ttl-reattach-still-live'
        persistSession({
          cloudId: 'c1',
          pageId,
          contentId: 'cc1',
          token: 'live-token',
          state: 'connected',
          expiresAt: Date.now() + 60000,
        })
        const bridgeOps = makeBridgeOps()
        const connect = vi.fn(() => makeFakeRelayClient())
        const session = useAgentLinkSession(bridgeOps, {
          macroType: 'sequence',
          relay: { boundContext: { cloudId: 'c1', pageId, contentId: 'cc1' }, requestSession: vi.fn(), connect },
        })

        session.attemptReattach()

        expect(session.state.value).toBe('connected')
        expect(connect).toHaveBeenCalledTimes(1)
      })
    })

    describe('hydrateFrom — mirrors the owner\'s TTL lapse onto the Fullscreen instance', () => {
      it('adopts "expired" directly when hydrating from idle', () => {
        const bridgeOps = makeBridgeOps()
        const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

        session.hydrateFrom({
          token: 'handed-off-token',
          cloudId: 'c1',
          pageId: 'page-1',
          contentId: 'cc1',
          state: 'expired',
        })

        expect(session.state.value).toBe('expired')
      })

      it('mirrors "connected" -> "expired" once the relay owner republishes the TTL lapse', () => {
        const bridgeOps = makeBridgeOps()
        const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
        session.hydrateFrom({
          token: 't',
          cloudId: 'c1',
          pageId: 'page-1',
          contentId: 'cc1',
          state: 'connected',
        })
        expect(session.state.value).toBe('connected')

        session.hydrateFrom({
          token: 't',
          cloudId: 'c1',
          pageId: 'page-1',
          contentId: 'cc1',
          state: 'expired',
        })

        expect(session.state.value).toBe('expired')
      })
    })
  })

  describe('relay wiring — relay-driven edits populate the activity feed + fire analytics (the gap this fix closes)', () => {
    function makeFakeRelayClient() {
      return { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: vi.fn(() => 'open') }
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

    it('a failing relay-driven update_diagram op fires agent_link_edit_failed and adds an error cue to the feed (Track F)', async () => {
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

      // Charter §6: a failed relay edit leaves a visible error line in the feed
      // (was: no feed entry). settleThinking('failed') is a no-op here since no
      // update_diagram op was in flight, so only the one error line is added.
      expect(session.activityFeed.value).toHaveLength(1)
      expect(session.activityFeed.value[0].summary).toMatch(/did not apply/i)
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

    it('a relay-driven read_page op fires agent_link_page_read (was registered with no firing site)', async () => {
      const bridgeOps = makeBridgeOps()
      let capturedOnPageRead: (() => void) | undefined
      const connect = vi.fn(
        (_wsUrl, _bridge, _onStateEvent, _onDiagUpdated, _onEditApplied, onPageRead) => {
          capturedOnPageRead = onPageRead
          return makeFakeRelayClient()
        }
      )
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

      expect(typeof capturedOnPageRead).toBe('function')
      capturedOnPageRead!()

      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_page_read',
        expect.objectContaining({ feature_area: 'agent_link', macro_type: 'sequence' })
      )
    })

    // Track U discovery: the transport callbacks (positions 7/8/9 of connect)
    // append an activity-feed row AND fire the matching Mixpanel event.
    async function wireAndCapture() {
      const bridgeOps = makeBridgeOps()
      const captured: {
        onDiagramRead?: (info: { title?: string; byContentId: boolean }) => void
        onSearchPerformed?: (info: { query: string; hits: number }) => void
        onListPerformed?: (info: { scope: 'page' | 'space' | 'site'; hits: number }) => void
      } = {}
      const connect = vi.fn(
        (
          _wsUrl,
          _bridge,
          _onStateEvent,
          _onDiagUpdated,
          _onEditApplied,
          _onPageRead,
          onDiagramRead,
          onSearchPerformed,
          onListPerformed
        ) => {
          captured.onDiagramRead = onDiagramRead
          captured.onSearchPerformed = onSearchPerformed
          captured.onListPerformed = onListPerformed
          return makeFakeRelayClient()
        }
      )
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })
      const session = useAgentLinkSession(bridgeOps, {
        macroType: 'sequence',
        relay: { boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'cc1' }, requestSession, connect },
      })
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()
      return { session, captured }
    }

    it('a relay-driven read_diagram op fires agent_link_diagram_read + a feed row', async () => {
      const { session, captured } = await wireAndCapture()
      const feedBefore = session.activityFeed.value.length

      captured.onDiagramRead!({ title: 'Checkout flow', byContentId: true })

      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_diagram_read',
        expect.objectContaining({ feature_area: 'agent_link', macro_type: 'sequence', by_content_id: true })
      )
      expect(session.activityFeed.value.length).toBe(feedBefore + 1)
      expect(session.activityFeed.value.at(-1)!.summary).toContain('Checkout flow')
    })

    it('a relay-driven search_diagrams op fires agent_link_search_performed with query_len+hits (never the raw query)', async () => {
      const { session, captured } = await wireAndCapture()

      captured.onSearchPerformed!({ query: 'payment-callback', hits: 3 })

      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_search_performed',
        expect.objectContaining({ macro_type: 'sequence', query_len: 'payment-callback'.length, hits: 3 })
      )
      // The raw query must NOT be sent to analytics (privacy) — only its length.
      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find((c) => c[0] === 'agent_link_search_performed')!
      expect(JSON.stringify(call[1])).not.toContain('payment-callback')
      expect(session.activityFeed.value.at(-1)!.summary).toContain('payment-callback')
    })

    it('a relay-driven list_diagrams op fires agent_link_list_performed with the scope', async () => {
      const { session, captured } = await wireAndCapture()

      captured.onListPerformed!({ scope: 'space', hits: 7 })

      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_list_performed',
        expect.objectContaining({ macro_type: 'sequence', list_scope: 'space', hits: 7 })
      )
      expect(session.activityFeed.value.at(-1)!.summary).toContain('7')
    })

    // Bug 2 fix (spot-check #3, 2026-07-09): before this fix, none of the
    // three discovery recorders touched the handoff record at all — only
    // the LOCAL activityFeed ref — so a search/list/read row was visible on
    // the owner's own rail but never reached a separate Fullscreen instance.
    it('a discovery op (search/list/read) republishes the handoff record with the new feed row, not just the local activityFeed', async () => {
      const { session, captured } = await wireAndCapture()

      captured.onSearchPerformed!({ query: 'payment', hits: 2 })

      const persisted = readSession('p1')
      expect(persisted?.feed?.at(-1)?.summary).toBe(session.activityFeed.value.at(-1)!.summary)
      expect(persisted?.state).toBe('connected')

      captured.onListPerformed!({ scope: 'page', hits: 4 })
      captured.onDiagramRead!({ title: 'Order flow', byContentId: false })

      const persistedAfterAll = readSession('p1')
      // All three discovery rows accumulated onto the SAME handoff record's
      // feed, in order — this is the actual data a Fullscreen instance would
      // hydrate from, not a synthetic reconstruction.
      expect(persistedAfterAll?.feed).toEqual(session.activityFeed.value)
      expect(persistedAfterAll?.feed?.length).toBeGreaterThanOrEqual(3)
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
      return { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: vi.fn(() => 'open') }
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

      // bug 2 fix: `feed` now travels on every handoff write, including the
      // mint-success 'waiting' record (see the dsl republish test's comment).
      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token-1',
        state: 'waiting',
        feed: [],
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

      // bug 2 fix: `feed` now travels on every handoff write (see the dsl
      // republish test's comment above for the rationale).
      expect(readSession(boundContext.pageId)).toEqual({
        ...boundContext,
        token: 'real-token-2',
        state: 'connected',
        feed: [],
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

    // Track G: mirroring the relay owner's own suspend/resume onto this
    // display-only (Fullscreen) instance's UI — "both surfaces must show the
    // state" (design contract).
    it('hydrates an idle instance directly into "suspended" when the persisted session is already suspended', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })

      session.hydrateFrom(makeHandoff({ state: 'suspended' }))

      expect(session.state.value).toBe('suspended')
      expect(session.token.value).toBe('handed-off-token')
    })

    it('mirrors "connected" -> "suspended" once the relay owner republishes the drop', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      session.hydrateFrom(makeHandoff({ state: 'connected' }))
      expect(session.state.value).toBe('connected')

      session.hydrateFrom(makeHandoff({ state: 'suspended' }))

      expect(session.state.value).toBe('suspended')
    })

    it('mirrors "suspended" -> "connected" once the relay owner republishes a successful resume', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      session.hydrateFrom(makeHandoff({ state: 'suspended' }))
      expect(session.state.value).toBe('suspended')

      session.hydrateFrom(makeHandoff({ state: 'connected' }))

      expect(session.state.value).toBe('connected')
    })

    // Bug 2 fix (spot-check #3, 2026-07-09): in the real cross-iframe
    // topology the Fullscreen rail showed no TTL countdown and no discovery
    // feed rows — the handoff record itself never carried expiresAt/feed, so
    // there was nothing for hydrateFrom() to read. These tests assert the
    // values land on the exposed `expiresAt`/`activityFeed` refs FROM THE
    // HANDOFF RECORD on a fresh instance that never had them locally —
    // exactly the gap that let bug 2 slip past H's component-level tests
    // (those injected props directly instead of driving them through
    // hydrateFrom()).
    it('hydrates expiresAt from the handoff record onto a fresh instance (TTL meter source)', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      expect(session.expiresAt.value).toBeNull()

      session.hydrateFrom(makeHandoff({ state: 'waiting', expiresAt: 1_800_000_000_000 }))

      expect(session.expiresAt.value).toBe(1_800_000_000_000)
    })

    it('does not clobber expiresAt when a later handoff record omits it', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      session.hydrateFrom(makeHandoff({ state: 'waiting', expiresAt: 1_800_000_000_000 }))
      expect(session.expiresAt.value).toBe(1_800_000_000_000)

      session.hydrateFrom(makeHandoff({ state: 'connected' }))

      expect(session.expiresAt.value).toBe(1_800_000_000_000)
    })

    it('hydrates discovery feed rows (search/list/read) from the handoff record\'s feed, not from injected props', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      expect(session.activityFeed.value).toEqual([])

      const feed = [
        { summary: 'Searched "payment" → 3 hits', at: 1000 },
        { summary: 'Listed diagrams in this space → 5', at: 2000 },
        { summary: 'Read "Checkout flow"', at: 3000 },
      ]
      session.hydrateFrom(makeHandoff({ state: 'connected', feed }))

      // Not merely "some entries were pushed" — the exact rows the owner
      // published, in order, land on the Fullscreen instance's own ref.
      expect(session.activityFeed.value).toEqual(feed)
    })

    it('replaces the local feed with a later handoff record\'s feed, including a reset back to empty', () => {
      const bridgeOps = makeBridgeOps()
      const session = useAgentLinkSession(bridgeOps, { macroType: 'sequence' })
      session.hydrateFrom(
        makeHandoff({ state: 'connected', feed: [{ summary: 'Read "A"', at: 1 }] })
      )
      expect(session.activityFeed.value).toHaveLength(1)

      // The owner reset its own feed (e.g. a fresh startConnect()) and
      // republished an empty one — an empty array is still a truthy,
      // deliberate handoff value, not "nothing to hydrate".
      session.hydrateFrom(makeHandoff({ state: 'connected', feed: [] }))

      expect(session.activityFeed.value).toEqual([])
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

  // Track F — perceived-latency "AI is thinking" state (charter §6): an
  // update_diagram op must instantly show acknowledgment on the render surface
  // BEFORE the round-trip completes, clear on success/failure/timeout (never a
  // stuck shimmer), and fire the two perceived-latency events with timings.
  describe('Track F — perceived-latency thinking state', () => {
    interface CapturedRelay {
      onStateEvent?: (e: any) => void
      onDiagramUpdated?: (dsl: string) => void
      onEditApplied?: (o: any) => void
    }

    // A relay session with captured callbacks + a fully-injected clock so
    // `now()` and the safety/error timers are deterministic (no wall clock).
    function setupThinking(
      opts: { macroType?: any; onDiagramUpdated?: (dsl: string, mt: any) => void } = {}
    ) {
      const captured: CapturedRelay = {}
      const connect = vi.fn(
        (_wsUrl, _bridge, onStateEvent, onDiagUpdated, onEditApplied) => {
          captured.onStateEvent = onStateEvent
          captured.onDiagramUpdated = onDiagUpdated
          captured.onEditApplied = onEditApplied
          return { send: vi.fn(), close: vi.fn(), disconnect: vi.fn(), getState: vi.fn(() => 'open') }
        }
      )
      const requestSession = vi.fn().mockResolvedValue({ token: 'real-token' })
      const timers: Array<{ fn: () => void; ms: number }> = []
      const clockState = { t: 1000 }
      const clock = {
        now: () => clockState.t,
        setTimeout: (fn: () => void, ms: number) => {
          const h = { fn, ms }
          timers.push(h)
          return h
        },
        clearTimeout: (h: any) => {
          const i = timers.indexOf(h)
          if (i >= 0) timers.splice(i, 1)
        },
      }
      const boundContext = { cloudId: 'c1', pageId: 'p-track-f', contentId: 'cc1' }
      const session = useAgentLinkSession(makeBridgeOps(), {
        macroType: opts.macroType ?? 'sequence',
        onDiagramUpdated: opts.onDiagramUpdated,
        clock,
        relay: { boundContext, requestSession, connect },
      })
      return { session, captured, timers, clockState, boundContext }
    }

    function fireTimer(timers: Array<{ fn: () => void; ms: number }>, ms: number) {
      const t = timers.find((x) => x.ms === ms)
      expect(t).toBeTruthy()
      t!.fn()
    }

    it('an update_diagram op instantly shows the thinking state and fires agent_link_first_feedback with ms_since_op_received', async () => {
      const { session, captured, clockState } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()

      clockState.t = 1500 // "now" when the composable processes the op
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 1200 })

      expect(session.thinkingState.value).toBe('thinking')
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_first_feedback',
        expect.objectContaining({
          feature_area: 'agent_link',
          macro_type: 'sequence',
          ms_since_op_received: 300, // 1500 - 1200
        })
      )
      expect(session.activityFeed.value.at(-1)!.summary).toMatch(/updating the diagram/i)
    })

    it('read_page / read_diagram ops never trigger the thinking state or first_feedback', async () => {
      const { session, captured } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()

      captured.onStateEvent!({ type: 'op', op: 'read_page', receivedAt: 1 })
      captured.onStateEvent!({ type: 'op', op: 'read_diagram', receivedAt: 2 })

      expect(session.thinkingState.value).toBe('idle')
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
        'agent_link_first_feedback',
        expect.anything()
      )
    })

    it('clears the thinking state on success only after the host confirms paint (notifyRenderSettled), with render+total timing', async () => {
      const { session, captured, clockState } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      clockState.t = 2000
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 2000 })
      expect(session.thinkingState.value).toBe('thinking')

      // persist succeeds → relay hands the new dsl to the store...
      clockState.t = 2300
      captured.onDiagramUpdated!('A->B: hi')
      captured.onEditApplied!({ ok: true, dsl: 'A->B: hi', summary: 'x', rendered: true })
      // ...but the shimmer stays until the host confirms the COMPLETE diagram
      // painted (hard constraint: never clear before the real render).
      expect(session.thinkingState.value).toBe('thinking')

      vi.mocked(trackAnalyticsEvent).mockClear()
      clockState.t = 2350
      session.notifyRenderSettled()

      expect(session.thinkingState.value).toBe('idle')
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_render_completed',
        expect.objectContaining({
          render_outcome: 'rendered',
          render_ms: 50, // 2350 - 2300 (dispatch → paint)
          total_ms: 350, // 2350 - 2000 (op received → paint)
        })
      )
    })

    it('a full success op fires BOTH first_feedback and render_completed, each with its timing prop', async () => {
      const { session, captured, clockState } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)
      vi.mocked(trackAnalyticsEvent).mockClear()

      clockState.t = 5100
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 5000 })
      clockState.t = 5200
      captured.onDiagramUpdated!('A->B: hi')
      captured.onEditApplied!({ ok: true, dsl: 'A->B: hi', rendered: true })
      clockState.t = 5250
      session.notifyRenderSettled()

      const names = vi.mocked(trackAnalyticsEvent).mock.calls.map((c) => c[0])
      expect(names).toContain('agent_link_first_feedback')
      expect(names).toContain('agent_link_render_completed')

      const ff = vi
        .mocked(trackAnalyticsEvent)
        .mock.calls.find((c) => c[0] === 'agent_link_first_feedback')!
      expect(ff[1]).toMatchObject({ ms_since_op_received: 100 }) // 5100 - 5000
      const rc = vi
        .mocked(trackAnalyticsEvent)
        .mock.calls.find((c) => c[0] === 'agent_link_render_completed')!
      expect(rc[1]).toMatchObject({ total_ms: 250, render_ms: 50 })
    })

    it('clears to an error cue on a failed op, fires render_completed:failed, then auto-returns to idle', async () => {
      const { session, captured, clockState, timers } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      clockState.t = 3000
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 3000 })
      vi.mocked(trackAnalyticsEvent).mockClear()

      clockState.t = 3400
      captured.onEditApplied!({ ok: false, dsl: 'A->B: hi', reason: 'version_conflict' })

      expect(session.thinkingState.value).toBe('error')
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_render_completed',
        expect.objectContaining({ render_outcome: 'failed', total_ms: 400 })
      )
      expect(
        session.activityFeed.value.some((e) => /did not apply/i.test(e.summary))
      ).toBe(true)

      // never a stuck error: the flash timer returns the surface to idle.
      clockState.t = 3400 + ERROR_FLASH_MS
      fireTimer(timers, ERROR_FLASH_MS)
      expect(session.thinkingState.value).toBe('idle')
    })

    it('the render-safety backstop auto-clears a stuck thinking state and fires render_completed:timeout', async () => {
      const { session, captured, clockState, timers } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      clockState.t = 4000
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 4000 })
      expect(session.thinkingState.value).toBe('thinking')
      vi.mocked(trackAnalyticsEvent).mockClear()

      // Simulate a dropped WS: no render/failure ever arrives → the 60s
      // backstop fires (evidence-based: ~1.5× the diagramly p99 of 40.5s).
      clockState.t = 4000 + RENDER_SAFETY_TIMEOUT_MS
      fireTimer(timers, RENDER_SAFETY_TIMEOUT_MS)

      expect(session.thinkingState.value).toBe('error')
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        'agent_link_render_completed',
        expect.objectContaining({
          render_outcome: 'timeout',
          total_ms: RENDER_SAFETY_TIMEOUT_MS,
        })
      )
      expect(
        session.activityFeed.value.some((e) => /timed out/i.test(e.summary))
      ).toBe(true)
    })

    it('a new op while thinking restarts the cycle without leaving the first op stuck', async () => {
      const { session, captured, clockState, timers } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      clockState.t = 6000
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 6000 })
      // a second op arrives before the first settled
      clockState.t = 6100
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 6100 })
      expect(session.thinkingState.value).toBe('thinking')

      // the first op's safety timer was cleared/replaced — only ONE 60s timer
      // is pending, keyed to the second op.
      const safetyTimers = timers.filter((t) => t.ms === RENDER_SAFETY_TIMEOUT_MS)
      expect(safetyTimers).toHaveLength(1)
    })

    // Cross-iframe (charter §6: "both surfaces must show the state"). The
    // Fullscreen modal never receives the op; it mirrors the relay owner's
    // `thinking` handoff flag via hydrateFrom().
    it('hydrateFrom mirrors a handoff thinking flag onto the Fullscreen surface + feed', () => {
      const session = useAgentLinkSession(makeBridgeOps(), { macroType: 'sequence' })

      session.hydrateFrom({
        token: 't',
        cloudId: 'c1',
        pageId: 'p1',
        contentId: 'cc1',
        state: 'connected',
        thinking: 'thinking',
      })

      expect(session.thinkingState.value).toBe('thinking')
      expect(
        session.activityFeed.value.some((e) => /updating the diagram/i.test(e.summary))
      ).toBe(true)

      session.hydrateFrom({
        token: 't',
        cloudId: 'c1',
        pageId: 'p1',
        contentId: 'cc1',
        state: 'connected',
        thinking: 'error',
      })
      expect(session.thinkingState.value).toBe('error')
    })

    it('hydrateFrom clears a mirrored shimmer when the resolved (no-thinking) record with the new dsl arrives', () => {
      const onDiagramUpdated = vi.fn()
      const session = useAgentLinkSession(makeBridgeOps(), {
        macroType: 'sequence',
        onDiagramUpdated,
      })

      session.hydrateFrom({
        token: 't',
        cloudId: 'c1',
        pageId: 'p1',
        contentId: 'cc1',
        state: 'connected',
        thinking: 'thinking',
      })
      expect(session.thinkingState.value).toBe('thinking')

      session.hydrateFrom({
        token: 't',
        cloudId: 'c1',
        pageId: 'p1',
        contentId: 'cc1',
        state: 'connected',
        dsl: 'A->B: hi',
      })

      expect(session.thinkingState.value).toBe('idle')
      expect(onDiagramUpdated).toHaveBeenCalledWith('A->B: hi', 'sequence')
    })

    it('re-hydrating the same thinking flag does not duplicate the feed line', () => {
      const session = useAgentLinkSession(makeBridgeOps(), { macroType: 'sequence' })
      const rec = {
        token: 't',
        cloudId: 'c1',
        pageId: 'p1',
        contentId: 'cc1',
        state: 'connected' as const,
        thinking: 'thinking' as const,
      }
      session.hydrateFrom(rec)
      session.hydrateFrom(rec)

      const thinkingLines = session.activityFeed.value.filter((e) =>
        /updating the diagram/i.test(e.summary)
      )
      expect(thinkingLines).toHaveLength(1)
    })

    it('disconnect clears any in-flight thinking state (no stuck shimmer after teardown)', async () => {
      const { session, captured, clockState } = setupThinking()
      session.startConnect()
      await vi.advanceTimersByTimeAsync(0)

      clockState.t = 7000
      captured.onStateEvent!({ type: 'op', op: 'update_diagram', receivedAt: 7000 })
      expect(session.thinkingState.value).toBe('thinking')

      session.disconnect('user')
      expect(session.thinkingState.value).toBe('idle')
    })
  })
})
