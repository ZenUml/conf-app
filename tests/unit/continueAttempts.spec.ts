import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  continueAttemptsKey,
  DEFAULT_CONTINUE_ATTEMPTS,
  getOrCreateContinueAttempts,
  useContinueAttempt,
} from '@/utils/paywall/continueAttempts'

const identity = {
  clientDomain: 'example-tenant',
  spaceKey: 'ENG',
  userAccountId: 'account-123',
}

describe('continueAttempts localStorage store', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes a user-space attempt record with 3 remaining attempts', () => {
    const now = new Date('2026-06-02T00:00:00.000Z')

    const state = getOrCreateContinueAttempts(identity, now)

    expect(DEFAULT_CONTINUE_ATTEMPTS).toBe(3)
    expect(state).toEqual({
      remainingAttempts: DEFAULT_CONTINUE_ATTEMPTS,
      firstTriggeredAt: '2026-06-02T00:00:00.000Z',
      lastUsedAt: null,
      exhaustedAt: null,
    })
    expect(JSON.parse(localStorage.getItem(continueAttemptsKey(identity)) || '{}')).toEqual(state)
  })

  // The default drop from 15 to 3 must not claw back attempts already granted:
  // anyone with a stored record keeps the balance they had.
  it.each([15, 12, 1])(
    'preserves a stored balance of %i attempts instead of applying the new default',
    (stored: number) => {
      localStorage.setItem(
        continueAttemptsKey(identity),
        JSON.stringify({
          remainingAttempts: stored,
          firstTriggeredAt: '2026-06-01T00:00:00.000Z',
          lastUsedAt: null,
          exhaustedAt: null,
        })
      )

      const state = getOrCreateContinueAttempts(identity, new Date('2026-08-16T00:00:00.000Z'))

      expect(state.remainingAttempts).toBe(stored)
      expect(state.firstTriggeredAt).toBe('2026-06-01T00:00:00.000Z')
    }
  )

  it('keeps decrementing a pre-existing 15-attempt balance from 15, not from the new default', () => {
    localStorage.setItem(
      continueAttemptsKey(identity),
      JSON.stringify({
        remainingAttempts: 15,
        firstTriggeredAt: '2026-06-01T00:00:00.000Z',
        lastUsedAt: null,
        exhaustedAt: null,
      })
    )

    const state = useContinueAttempt(identity, new Date('2026-08-16T00:05:00.000Z'))

    expect(state.remainingAttempts).toBe(14)
    expect(state.exhaustedAt).toBeNull()
  })

  it('decrements only when a continue attempt is used', () => {
    const first = new Date('2026-06-02T00:00:00.000Z')
    const second = new Date('2026-06-02T00:05:00.000Z')
    getOrCreateContinueAttempts(identity, first)

    const state = useContinueAttempt(identity, second)

    expect(state.remainingAttempts).toBe(DEFAULT_CONTINUE_ATTEMPTS - 1)
    expect(state.firstTriggeredAt).toBe('2026-06-02T00:00:00.000Z')
    expect(state.lastUsedAt).toBe('2026-06-02T00:05:00.000Z')
    expect(state.exhaustedAt).toBeNull()
  })

  it('marks exhausted when the last attempt is used', () => {
    const key = continueAttemptsKey(identity)
    localStorage.setItem(
      key,
      JSON.stringify({
        remainingAttempts: 1,
        firstTriggeredAt: '2026-06-02T00:00:00.000Z',
        lastUsedAt: null,
        exhaustedAt: null,
      })
    )

    const state = useContinueAttempt(identity, new Date('2026-06-02T00:10:00.000Z'))

    expect(state.remainingAttempts).toBe(0)
    expect(state.exhaustedAt).toBe('2026-06-02T00:10:00.000Z')
  })

  it('defaults to 3 when stored data is corrupt', () => {
    localStorage.setItem(continueAttemptsKey(identity), 'not-json')

    const state = getOrCreateContinueAttempts(identity, new Date('2026-06-02T00:00:00.000Z'))

    expect(state.remainingAttempts).toBe(3)
  })

  it('defaults to 3 when localStorage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    const state = getOrCreateContinueAttempts(identity, new Date('2026-06-02T00:00:00.000Z'))

    expect(state.remainingAttempts).toBe(3)
    getItem.mockRestore()
  })
})
