import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  persistSession,
  readSession,
  readAnySession,
  clearSession,
  subscribeToHandoff,
  subscribeToAnyHandoff,
  HANDOFF_TTL_MS,
  HANDOFF_FEED_MAX_ENTRIES,
  DEFAULT_HANDOFF_POLL_INTERVAL_MS,
  DEFAULT_HANDOFF_POLL_TIMEOUT_MS,
} from './sessionHandoff'
import type { AgentLinkHandoffSession } from './sessionHandoff'

function makeSession(overrides: Partial<AgentLinkHandoffSession> = {}): AgentLinkHandoffSession {
  return {
    token: 'tok_abc123',
    cloudId: 'cloud-1',
    pageId: 'page-1',
    contentId: 'content-1',
    state: 'waiting',
    ...overrides,
  }
}

describe('sessionHandoff', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persistSession then readSession round-trips the same session', () => {
    const session = makeSession()
    persistSession(session)

    expect(readSession('page-1')).toEqual(session)
  })

  it('readSession returns null when nothing was persisted for that pageId', () => {
    expect(readSession('page-never-persisted')).toBeNull()
  })

  it('persistSession scopes the record by pageId — a different page reads nothing', () => {
    persistSession(makeSession({ pageId: 'page-1' }))

    expect(readSession('page-2')).toBeNull()
  })

  it('readSession reflects the connected state once re-persisted', () => {
    persistSession(makeSession({ state: 'waiting' }))
    persistSession(makeSession({ state: 'connected' }))

    expect(readSession('page-1')).toMatchObject({ state: 'connected' })
  })

  // #314: 'expired' is a recognized handoff state (isValidPersisted's
  // whitelist) so a Fullscreen instance can hydrate the relay owner's own
  // TTL-lapse instead of the record being silently rejected as invalid.
  it('readSession recognizes an "expired" persisted record (not rejected as invalid)', () => {
    persistSession(makeSession({ state: 'connected' }))
    persistSession(makeSession({ state: 'expired' }))

    expect(readSession('page-1')).toMatchObject({ state: 'expired' })
  })

  // dsl is optional on the handoff record — present once the relay owner has
  // republished an agent edit, absent on the initial waiting/connected write.
  it('persistSession then readSession round-trips an included dsl string', () => {
    const session = makeSession({ state: 'connected', dsl: 'A->B: hi' })
    persistSession(session)

    expect(readSession('page-1')).toEqual(session)
  })

  it('readSession reports dsl as undefined when the record was persisted without one', () => {
    persistSession(makeSession())

    expect(readSession('page-1')?.dsl).toBeUndefined()
  })

  // Track F: the perceived-latency cue crosses the iframe boundary on the
  // handoff record so the Fullscreen modal mirrors the shimmer/error.
  it('persistSession then readSession round-trips the thinking cue', () => {
    const session = makeSession({ state: 'connected', thinking: 'thinking' })
    persistSession(session)

    expect(readSession('page-1')).toEqual(session)
  })

  it('round-trips only the normalized display-level live client label', () => {
    persistSession(makeSession({ state: 'connected', clientLabel: 'Claude Code' }))
    expect(readSession('page-1')?.clientLabel).toBe('Claude Code')

    const raw = JSON.parse(localStorage.getItem('agentLinkSession:page-1')!)
    raw.clientLabel = 'raw clientInfo with version and secret metadata'
    localStorage.setItem('agentLinkSession:page-1', JSON.stringify(raw))
    expect(readSession('page-1')?.clientLabel).toBe('an AI agent')
  })

  it('normalizes an unrecognized thinking value to undefined (idle)', () => {
    persistSession(makeSession({ state: 'connected' }))
    // hand-write a bogus thinking value
    const raw = JSON.parse(localStorage.getItem('agentLinkSession:page-1')!)
    raw.thinking = 'bogus'
    localStorage.setItem('agentLinkSession:page-1', JSON.stringify(raw))

    expect(readSession('page-1')?.thinking).toBeUndefined()
  })

  it('readSession returns null once the record is older than HANDOFF_TTL_MS', () => {
    const session = makeSession()
    persistSession(session)
    // Read the stamp back rather than sampling the clock beforehand.
    // persistSession calls Date.now() itself, so a pre-sampled `persistedAt`
    // is one tick early whenever the millisecond rolls over between the two —
    // and then `persistedAt + TTL + 1` is only TTL past the REAL stamp, which
    // isValidPersisted still accepts (`<=`). That made this test fail roughly
    // whenever the timing went that way (observed on CI, run 30145695554).
    const persistedAt: number = JSON.parse(
      localStorage.getItem('agentLinkSession:page-1')!
    ).persistedAt

    // Still readable just under the TTL...
    expect(readSession('page-1', persistedAt + HANDOFF_TTL_MS - 1)).toEqual(session)
    // ...but not once `now` is past it (readSession's `now` param is
    // injectable specifically so this doesn't need fake timers).
    expect(readSession('page-1', persistedAt + HANDOFF_TTL_MS + 1)).toBeNull()
  })

  it('clearSession removes the record so a later readSession returns null', () => {
    persistSession(makeSession())
    expect(readSession('page-1')).not.toBeNull()

    clearSession('page-1')

    expect(readSession('page-1')).toBeNull()
  })

  it('readSession returns null for malformed JSON instead of throwing', () => {
    localStorage.setItem('agentLinkSession:page-1', '{not json')

    expect(() => readSession('page-1')).not.toThrow()
    expect(readSession('page-1')).toBeNull()
  })

  it('readSession returns null when required fields are missing', () => {
    localStorage.setItem(
      'agentLinkSession:page-1',
      JSON.stringify({ token: 'tok', persistedAt: Date.now() })
    )

    expect(readSession('page-1')).toBeNull()
  })

  it('readSession returns null for an unrecognized state value', () => {
    localStorage.setItem(
      'agentLinkSession:page-1',
      JSON.stringify({
        token: 'tok',
        cloudId: 'c',
        pageId: 'page-1',
        contentId: 'd',
        state: 'bogus',
        persistedAt: Date.now(),
      })
    )

    expect(readSession('page-1')).toBeNull()
  })

  it('persistSession does not throw when localStorage.setItem throws', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded')
    }
    try {
      expect(() => persistSession(makeSession())).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })

  // Bug 2 fix (spot-check #3, 2026-07-09): the Fullscreen rail showed no TTL
  // countdown and no discovery feed rows in the real cross-iframe topology
  // because the handoff record carried neither `expiresAt` nor a feed
  // snapshot at all. These two fields now round-trip like dsl/thinking do.
  it('persistSession then readSession round-trips expiresAt and a bounded feed', () => {
    const feed = [
      { summary: 'Searched "payment" → 3 hits', at: 1000 },
      { summary: 'Read "Checkout flow"', at: 2000 },
    ]
    const session = makeSession({ state: 'connected', expiresAt: 123456789, feed })
    persistSession(session)

    expect(readSession('page-1')).toEqual(session)
  })

  it('persistSession then readSession round-trips lastActivityAt', () => {
    const session = makeSession({ state: 'connected', lastActivityAt: 987_654_321 })
    persistSession(session)

    expect(readSession('page-1')).toEqual(session)
  })

  it('readSession reports expiresAt and feed as undefined when persisted without them', () => {
    persistSession(makeSession())

    const read = readSession('page-1')
    expect(read?.expiresAt).toBeUndefined()
    expect(read?.feed).toBeUndefined()
    expect(read?.lastActivityAt).toBeUndefined()
  })

  // "refreshed on each persist": persistSession is the single point that
  // enforces the HANDOFF_FEED_MAX_ENTRIES bound, so every write — regardless
  // of how large the caller's own in-memory feed has grown — stays capped.
  it('bounds the persisted feed to the last HANDOFF_FEED_MAX_ENTRIES entries, dropping the oldest', () => {
    expect(HANDOFF_FEED_MAX_ENTRIES).toBe(20)
    const oversized = Array.from({ length: HANDOFF_FEED_MAX_ENTRIES + 1 }, (_, i) => ({
      summary: `row-${i}`,
      at: i,
    }))
    persistSession(makeSession({ state: 'connected', feed: oversized }))

    const read = readSession('page-1')
    expect(read?.feed).toHaveLength(HANDOFF_FEED_MAX_ENTRIES)
    // The 21st entry (row-0, the oldest) was dropped; row-1..row-20 survive.
    expect(read?.feed?.[0]).toEqual({ summary: 'row-1', at: 1 })
    expect(read?.feed?.at(-1)).toEqual({ summary: `row-${HANDOFF_FEED_MAX_ENTRIES}`, at: HANDOFF_FEED_MAX_ENTRIES })
  })

  // Reactive hydration (mint-vs-mount race, 2026-07-09 live spot-check): a
  // one-shot readSession() can lose to another same-origin document's
  // persistSession() call that lands a moment later. subscribeToHandoff()
  // covers that with a `storage` event listener plus a bounded poll
  // fallback — see sessionHandoff.ts's header comment.
  describe('subscribeToHandoff', () => {
    afterEach(() => {
      // restoreAllMocks() BEFORE useRealTimers(): the 'stops polling...' test
      // below does `vi.spyOn(global, 'clearInterval')` while fake timers are
      // active. Left un-restored, that spy poisons the global `clearInterval`
      // binding for every later real-timer test in this file (reproduced in
      // isolation — vi.useRealTimers() alone does not undo a spy created
      // while it was faked, and the bare `clearInterval` identifier the
      // subscribeToHandoff*/subscribeToAnyHandoff implementation calls then
      // resolves to `undefined` instead of the real function).
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('delivers the session the instant another document fires a matching storage event', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession)

      persistSession(makeSession())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))

      expect(onSession).toHaveBeenCalledTimes(1)
      expect(onSession).toHaveBeenCalledWith(makeSession())

      unsubscribe()
    })

    it('ignores a storage event for a different key', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession)

      persistSession(makeSession({ pageId: 'page-2' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-2' }))

      expect(onSession).not.toHaveBeenCalled()
      unsubscribe()
    })

    it('falls back to the poll when the storage event never fires', () => {
      vi.useFakeTimers()
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession, {
        pollIntervalMs: 100,
        pollTimeoutMs: 1000,
      })

      persistSession(makeSession())
      // No storage event dispatched — only the poll tick should find it.
      vi.advanceTimersByTime(100)

      expect(onSession).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('delivers only once even if the storage event and a poll tick race', () => {
      vi.useFakeTimers()
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession, {
        pollIntervalMs: 50,
        pollTimeoutMs: 1000,
      })

      persistSession(makeSession())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      vi.advanceTimersByTime(50)

      expect(onSession).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('stops polling once the bounded window elapses without a session ever appearing', () => {
      vi.useFakeTimers()
      const onSession = vi.fn()
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
      subscribeToHandoff('page-1', onSession, { pollIntervalMs: 100, pollTimeoutMs: 500 })

      vi.advanceTimersByTime(500)
      expect(onSession).not.toHaveBeenCalled()
      expect(clearIntervalSpy).toHaveBeenCalled()

      // A session persisted AFTER the window elapsed must not retroactively
      // fire — the poll already stopped itself.
      persistSession(makeSession())
      vi.advanceTimersByTime(1000)
      expect(onSession).not.toHaveBeenCalled()
    })

    // Regression (2026-07-09): reaching 'connected' used to set an internal
    // `settled` flag that short-circuited every later tryDeliver() — so a
    // dsl-only update (an agent edit; state stays 'connected', same token)
    // persisted AFTER the first connected delivery was silently dropped.
    // `settled` is now reserved for unsubscribe only — the poll stops, but
    // the storage listener must keep delivering fresh dsl updates.
    it('keeps delivering dsl-only updates after the session is already connected (settled must not block later edits)', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession)

      persistSession(makeSession({ state: 'connected' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(1)

      // A later agent edit republishes the same connected record with a new
      // dsl — the fingerprint includes dsl, so this must be seen as fresh.
      persistSession(makeSession({ state: 'connected', dsl: 'A->B: hi' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(2)
      expect(onSession).toHaveBeenLastCalledWith(
        makeSession({ state: 'connected', dsl: 'A->B: hi' })
      )

      // A second, different dsl must fire again...
      persistSession(makeSession({ state: 'connected', dsl: 'A->B: hi\nB->C: bye' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(3)

      // ...but re-delivering the IDENTICAL record must not double-fire.
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(3)

      unsubscribe()
    })

    // Track F: an op begins/fails as a THINKING-only change — state stays
    // 'connected', token + dsl unchanged, only `thinking` flips. The
    // fingerprint includes `thinking`, so this must be delivered (else the
    // Fullscreen shimmer would never light).
    it('delivers a thinking-only change (same state/token/dsl, only thinking flips)', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession)

      persistSession(makeSession({ state: 'connected' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(1)

      persistSession(makeSession({ state: 'connected', thinking: 'thinking' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(2)
      expect(onSession).toHaveBeenLastCalledWith(
        makeSession({ state: 'connected', thinking: 'thinking' })
      )

      // flip to error → still a fresh fingerprint
      persistSession(makeSession({ state: 'connected', thinking: 'error' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(3)

      unsubscribe()
    })

    it('after unsubscribe, no further onSession fires even for a later dsl-only update', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession)

      persistSession(makeSession({ state: 'connected' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      expect(onSession).toHaveBeenCalledTimes(1)

      unsubscribe()

      persistSession(makeSession({ state: 'connected', dsl: 'A->B: hi' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))

      expect(onSession).toHaveBeenCalledTimes(1)
    })

    it('unsubscribe removes the storage listener and stops the poll interval', () => {
      vi.useFakeTimers()
      const onSession = vi.fn()
      const unsubscribe = subscribeToHandoff('page-1', onSession, {
        pollIntervalMs: 50,
        pollTimeoutMs: 1000,
      })

      unsubscribe()
      persistSession(makeSession())
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-1' }))
      vi.advanceTimersByTime(1000)

      expect(onSession).not.toHaveBeenCalled()
    })

    it('exposes default poll bounds matching the design (~400ms interval, ~8s ceiling)', () => {
      expect(DEFAULT_HANDOFF_POLL_INTERVAL_MS).toBe(400)
      expect(DEFAULT_HANDOFF_POLL_TIMEOUT_MS).toBe(8000)
    })
  })

  // pageId-less Fullscreen fallback (finding #4, 2026-07-09 live spot-check):
  // the Fullscreen modal iframe doesn't always resolve a boundContext.pageId
  // (see GenericViewer.vue's mounted() comment) — readAnySession() scans
  // every agentLinkSession:* key instead of one scoped key.
  describe('readAnySession', () => {
    it('returns null when nothing is persisted', () => {
      expect(readAnySession()).toBeNull()
    })

    it('finds a session persisted under an arbitrary pageId key', () => {
      persistSession(makeSession({ pageId: 'page-77' }))

      expect(readAnySession()).toEqual(makeSession({ pageId: 'page-77' }))
    })

    it('round-trips an included dsl string', () => {
      persistSession(makeSession({ pageId: 'page-77', dsl: 'A->B: hi' }))

      expect(readAnySession()).toEqual(makeSession({ pageId: 'page-77', dsl: 'A->B: hi' }))
    })

    it('returns the freshest record when multiple pageIds have live sessions', () => {
      const now = Date.now()
      persistSession(makeSession({ pageId: 'page-old', token: 'tok-old' }))
      // Force a later persistedAt for the second record by writing it raw
      // (persistSession always stamps Date.now(), which could tie in a fast
      // test run) — explicit persistedAt values make the ordering assertion
      // deterministic.
      localStorage.setItem(
        'agentLinkSession:page-old',
        JSON.stringify({ ...makeSession({ pageId: 'page-old', token: 'tok-old' }), persistedAt: now - 1000 })
      )
      localStorage.setItem(
        'agentLinkSession:page-new',
        JSON.stringify({ ...makeSession({ pageId: 'page-new', token: 'tok-new' }), persistedAt: now })
      )

      expect(readAnySession(now)).toMatchObject({ pageId: 'page-new', token: 'tok-new' })
    })

    it('ignores non-agentLinkSession keys in localStorage', () => {
      localStorage.setItem('some-other-key', JSON.stringify({ unrelated: true }))

      expect(readAnySession()).toBeNull()
    })

    it('ignores expired records and malformed JSON while scanning', () => {
      const now = Date.now()
      localStorage.setItem(
        'agentLinkSession:page-expired',
        JSON.stringify({ ...makeSession({ pageId: 'page-expired' }), persistedAt: now - HANDOFF_TTL_MS - 1 })
      )
      localStorage.setItem('agentLinkSession:page-bad', '{not json')

      expect(readAnySession(now)).toBeNull()
    })
  })

  describe('subscribeToAnyHandoff', () => {
    // Guard against fake-timer residue from the subscribeToHandoff describe
    // above — vi.useRealTimers() there restores real timers for ITS tests,
    // but this describe's own real-timer tests (below) need a clean slate
    // too, so restore explicitly on the way in as well as the way out.
    beforeEach(() => {
      vi.useRealTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('delivers a session for ANY pageId the instant a matching storage event fires', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToAnyHandoff(onSession)

      persistSession(makeSession({ pageId: 'page-42' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-42' }))

      expect(onSession).toHaveBeenCalledTimes(1)
      expect(onSession).toHaveBeenCalledWith(makeSession({ pageId: 'page-42' }))
      unsubscribe()
    })

    it('ignores a storage event for an unrelated key', () => {
      const onSession = vi.fn()
      const unsubscribe = subscribeToAnyHandoff(onSession)

      localStorage.setItem('some-other-key', 'x')
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }))

      expect(onSession).not.toHaveBeenCalled()
      unsubscribe()
    })

    it('falls back to the poll when the storage event never fires', () => {
      vi.useFakeTimers()
      const onSession = vi.fn()
      const unsubscribe = subscribeToAnyHandoff(onSession, { pollIntervalMs: 100, pollTimeoutMs: 1000 })

      persistSession(makeSession({ pageId: 'page-poll' }))
      vi.advanceTimersByTime(100)

      expect(onSession).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('unsubscribe stops both the storage listener and the poll', () => {
      vi.useFakeTimers()
      const onSession = vi.fn()
      const unsubscribe = subscribeToAnyHandoff(onSession, { pollIntervalMs: 50, pollTimeoutMs: 1000 })

      unsubscribe()
      persistSession(makeSession({ pageId: 'page-late' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-late' }))
      vi.advanceTimersByTime(1000)

      expect(onSession).not.toHaveBeenCalled()
    })
  })
})
