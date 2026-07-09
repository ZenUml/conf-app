import { describe, it, expect, beforeEach } from 'vitest'
import { persistSession, readSession, clearSession, HANDOFF_TTL_MS } from './sessionHandoff'
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
})
