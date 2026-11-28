import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { getLocalStorageKey } from '@/utils/window'
import {
  TEAM_SHARE_PENDING_KEY,
  TEAM_SHARE_ARM_TIMEOUT_MS,
  armTeamShareIfEligible,
  clearTeamSharePending,
  isTeamSharePendingFor,
  isTeamSharePendingNow,
  isTeamShareShown,
  markTeamShareShown,
  readTeamSharePending,
  siteCountBucket,
  usableDiagramTitle,
} from './teamShare'

const original = (forgeGlobal as any).forgeContext

function setContext(extra: Record<string, unknown> = {}) {
  ;(forgeGlobal as any).forgeContext = {
    accountId: 'acct-1',
    extension: { content: { id: '555' }, location: 'https://example-tenant.atlassian.net/wiki/spaces/ENG/pages/555/Title', ...extra },
  }
}

function wrapper(count: number | Error | 'hang', pageId = '555') {
  return {
    countSiteDiagramsUpTo: vi.fn(() =>
      count === 'hang' ? new Promise<number>(() => {}) : count instanceof Error ? Promise.reject(count) : Promise.resolve(count),
    ),
    _getCurrentPageId: vi.fn(async () => pageId),
  } as any
}

describe('teamShare', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('mockClientDomain', 'example-tenant')
    vi.stubEnv('PRODUCT_TYPE', 'lite')
    setContext()
  })
  afterEach(() => {
    ;(forgeGlobal as any).forgeContext = original
    vi.useRealTimers()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  describe('armTeamShareIfEligible', () => {
    it('arms for lite with a small site and writes the marker', async () => {
      const w = wrapper(3)
      expect(await armTeamShareIfEligible({ contentId: '9', diagramTitle: 'Flow', apWrapper: w })).toBe(true)
      expect(w.countSiteDiagramsUpTo).toHaveBeenCalledWith(6)
      expect(readTeamSharePending()).toMatchObject({ pageId: '555', contentId: '9', diagramTitle: 'Flow', siteDiagramCount: 3 })
    })

    it('arms for full, and at exactly 5 diagrams', async () => {
      vi.stubEnv('PRODUCT_TYPE', 'full')
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: wrapper(5) })).toBe(true)
    })

    it('does not arm at 6 diagrams', async () => {
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: wrapper(6) })).toBe(false)
      expect(readTeamSharePending()).toBeNull()
    })

    it.each(['diagramly', 'asyncapi'])('does not arm for %s', async (product) => {
      vi.stubEnv('PRODUCT_TYPE', product)
      const w = wrapper(1)
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: w })).toBe(false)
      expect(w.countSiteDiagramsUpTo).not.toHaveBeenCalled()
    })

    it('does not arm when this account was already shown, without paying the search', async () => {
      markTeamShareShown()
      const w = wrapper(1)
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: w })).toBe(false)
      expect(w.countSiteDiagramsUpTo).not.toHaveBeenCalled()
    })

    it('does not arm on a draft page (id 0)', async () => {
      ;(forgeGlobal as any).forgeContext = { accountId: 'acct-1', extension: { content: { id: '0' } } }
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: wrapper(1, '0') })).toBe(false)
    })

    it('falls back to the wrapper for the page id', async () => {
      ;(forgeGlobal as any).forgeContext = { accountId: 'acct-1', extension: {} }
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: wrapper(1, '777') })).toBe(true)
      expect(readTeamSharePending()?.pageId).toBe('777')
    })

    it('does not arm when the search fails', async () => {
      expect(await armTeamShareIfEligible({ contentId: '9', apWrapper: wrapper(new Error('403')) })).toBe(false)
      expect(readTeamSharePending()).toBeNull()
    })

    it('does not arm when the search outlasts the timeout', async () => {
      vi.useFakeTimers()
      const p = armTeamShareIfEligible({ contentId: '9', apWrapper: wrapper('hang') })
      await vi.advanceTimersByTimeAsync(TEAM_SHARE_ARM_TIMEOUT_MS + 1)
      expect(await p).toBe(false)
      expect(readTeamSharePending()).toBeNull()
    })
  })

  describe('pending gate', () => {
    const arm = () => armTeamShareIfEligible({ contentId: '9', diagramTitle: 'Flow', apWrapper: wrapper(2) })

    it('is pending for the same page, fresh, view mode', async () => {
      await arm()
      expect(isTeamSharePendingNow()).toBe(true)
    })

    it('is not pending for another page', async () => {
      await arm()
      expect(isTeamSharePendingFor('556')).toBe(false)
      setContext()
      ;(forgeGlobal as any).forgeContext.extension.content.id = '556'
      expect(isTeamSharePendingNow()).toBe(false)
    })

    it('is not pending in the editor', async () => {
      await arm()
      setContext({ location: 'https://example-tenant.atlassian.net/wiki/spaces/ENG/pages/edit-v2/555' })
      expect(isTeamSharePendingNow()).toBe(false)
      setContext({ location: 'https://example-tenant.atlassian.net/wiki/pages/resumedraft.action/edit/555' })
      expect(isTeamSharePendingNow()).toBe(false)
    })

    it('expires after 24 hours', async () => {
      await arm()
      const ts = readTeamSharePending()!.ts
      expect(isTeamSharePendingFor('555', ts + 24 * 3600 * 1000 - 1)).toBe(true)
      expect(isTeamSharePendingFor('555', ts + 24 * 3600 * 1000)).toBe(false)
    })

    it('is not pending once shown, and clear removes the marker', async () => {
      await arm()
      markTeamShareShown()
      expect(isTeamShareShown()).toBe(true)
      expect(isTeamSharePendingNow()).toBe(false)
      clearTeamSharePending()
      expect(localStorage.getItem(getLocalStorageKey(TEAM_SHARE_PENDING_KEY))).toBeNull()
    })

    it('shown is per account', () => {
      markTeamShareShown('acct-1')
      expect(isTeamShareShown('acct-1')).toBe(true)
      expect(isTeamShareShown('acct-2')).toBe(false)
    })

    it('is not pending for diagramly', async () => {
      await arm()
      vi.stubEnv('PRODUCT_TYPE', 'diagramly')
      expect(isTeamSharePendingNow()).toBe(false)
    })

    it('survives corrupt storage as not pending', () => {
      localStorage.setItem(getLocalStorageKey(TEAM_SHARE_PENDING_KEY), '{not json')
      expect(isTeamSharePendingNow()).toBe(false)
    })
  })

  describe('usableDiagramTitle', () => {
    it.each([
      ['Checkout flow', 'Checkout flow'],
      ['  Checkout flow  ', 'Checkout flow'],
      ['', ''],
      ['   ', ''],
      [undefined, ''],
      ['Untitled 2026-11-28T00:00:00.000Z', ''],
      ['untitled', ''],
      ['3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b', ''],
      ['3f2b8c1e4a5d4e6f8a9b0c1d2e3f4a5b', ''],
    ])('%j -> %j', (input, out) => {
      expect(usableDiagramTitle(input as string | undefined)).toBe(out)
    })
  })

  it('buckets the site count', () => {
    expect(siteCountBucket(0)).toBe('1')
    expect(siteCountBucket(1)).toBe('1')
    expect(siteCountBucket(2)).toBe('2-5')
    expect(siteCountBucket(5)).toBe('2-5')
  })
})
