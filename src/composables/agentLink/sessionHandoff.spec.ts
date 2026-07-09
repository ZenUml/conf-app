import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  persistSession,
  readSession,
  clearSession,
  subscribeToHandoff,
  HANDOFF_TTL_MS,
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

  it('readSession returns null once the record is older than HANDOFF_TTL_MS', () => {
    const session = makeSession()
    const persistedAt = Date.now()
    persistSession(session)

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

  // Reactive hydration (mint-vs-mount race, 2026-07-09 live spot-check): a
  // one-shot readSession() can lose to another same-origin document's
  // persistSession() call that lands a moment later. subscribeToHandoff()
  // covers that with a `storage` event listener plus a bounded poll
  // fallback — see sessionHandoff.ts's header comment.
  describe('subscribeToHandoff', () => {
    afterEach(() => {
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
})
