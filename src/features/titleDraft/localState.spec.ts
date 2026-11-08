import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import {
  deriveTitleDraftIdentity,
  markNotNow,
  isNotNow,
  recordLookup,
  isLookupFresh,
  canShowEntryFlag,
  markEntryFlagShown,
  consumeFirstNotNow,
  writeJustAdded,
  takeJustAdded,
} from './localState'

const HOUR = 3600_000
const NOW = Date.parse('2026-11-08T00:00:00.000Z')
const A = { clientDomain: 'example-tenant', accountId: 'acc-1' }
const B = { clientDomain: 'example-tenant', accountId: 'acc-2' }
const OTHER_SITE = { clientDomain: 'other-tenant', accountId: 'acc-1' }

describe('title draft local state', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  describe('identity', () => {
    it('is null without an account id', () => {
      ;(forgeGlobal as any).forgeContext = { extension: { content: { id: '1' } } }
      expect(deriveTitleDraftIdentity()).toBeNull()
    })
    it('combines site and account when both exist', () => {
      localStorage.setItem('mockClientDomain', 'example-tenant')
      ;(forgeGlobal as any).forgeContext = { accountId: 'acc-1' }
      expect(deriveTitleDraftIdentity()).toEqual({ clientDomain: 'example-tenant', accountId: 'acc-1' })
    })
  })

  it('Not now is permanent per person per page', () => {
    expect(isNotNow(A, 'p1')).toBe(false)
    markNotNow(A, 'p1')
    expect(isNotNow(A, 'p1')).toBe(true)
    expect(isNotNow(A, 'p2')).toBe(false)
    expect(isNotNow(B, 'p1')).toBe(false)
    expect(isNotNow(OTHER_SITE, 'p1')).toBe(false)
  })

  it('lookup is fresh for 24 hours only', () => {
    expect(isLookupFresh(A, 'p1', NOW)).toBe(false)
    recordLookup(A, 'p1', NOW)
    expect(isLookupFresh(A, 'p1', NOW + 24 * HOUR - 1)).toBe(true)
    expect(isLookupFresh(A, 'p1', NOW + 24 * HOUR)).toBe(false)
    expect(isLookupFresh(A, 'p2', NOW)).toBe(false)
  })

  it('shows at most one entry flag per person per site per 24 hours', () => {
    expect(canShowEntryFlag(A, NOW)).toBe(true)
    markEntryFlagShown(A, NOW)
    expect(canShowEntryFlag(A, NOW + HOUR)).toBe(false)
    expect(canShowEntryFlag(A, NOW + 24 * HOUR)).toBe(true)
    expect(canShowEntryFlag(B, NOW + HOUR)).toBe(true)
    expect(canShowEntryFlag(OTHER_SITE, NOW + HOUR)).toBe(true)
  })

  it('consumeFirstNotNow is true exactly once per person per site', () => {
    expect(consumeFirstNotNow(A)).toBe(true)
    expect(consumeFirstNotNow(A)).toBe(false)
    expect(consumeFirstNotNow(B)).toBe(true)
    expect(consumeFirstNotNow(OTHER_SITE)).toBe(true)
  })

  describe('just added', () => {
    it('returns and clears a matching record under 2 minutes old', () => {
      writeJustAdded(A, { pageId: 'p1', contentId: 'c1', at: NOW })
      expect(takeJustAdded(A, 'p1', NOW + 119_000)).toEqual({ pageId: 'p1', contentId: 'c1', at: NOW })
      expect(takeJustAdded(A, 'p1', NOW + 119_000)).toBeNull()
    })
    it('ignores a record for another page or older than 2 minutes', () => {
      writeJustAdded(A, { pageId: 'p1', contentId: 'c1', at: NOW })
      expect(takeJustAdded(A, 'p2', NOW)).toBeNull()
      expect(takeJustAdded(A, 'p1', NOW + 120_000)).toBeNull()
    })
    it('does not leak across people', () => {
      writeJustAdded(A, { pageId: 'p1', contentId: 'c1', at: NOW })
      expect(takeJustAdded(B, 'p1', NOW)).toBeNull()
    })
  })

  describe('storage unavailable fails closed and never throws', () => {
    beforeEach(() => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
    })
    it('readers say no offer', () => {
      expect(() => markNotNow(A, 'p1')).not.toThrow()
      expect(isNotNow(A, 'p1')).toBe(true)
      expect(() => recordLookup(A, 'p1', NOW)).not.toThrow()
      expect(isLookupFresh(A, 'p1', NOW)).toBe(true)
      expect(() => markEntryFlagShown(A, NOW)).not.toThrow()
      expect(canShowEntryFlag(A, NOW)).toBe(false)
      expect(consumeFirstNotNow(A)).toBe(false)
      expect(() => writeJustAdded(A, { pageId: 'p1', contentId: 'c', at: NOW })).not.toThrow()
      expect(takeJustAdded(A, 'p1', NOW)).toBeNull()
    })
  })
})
