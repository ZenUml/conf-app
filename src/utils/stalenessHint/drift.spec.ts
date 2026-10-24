import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/requestUtil', () => ({ forgeRequest: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { forgeRequest } from '@/utils/requestUtil'
import { countVersionsSince, getDrift } from './drift'

const CUTOFF = '2026-07-10T00:00:00Z'
const v = (createdAt: string) => ({ createdAt })

describe('countVersionsSince (newest-first walk, spike Q3 recipe)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('stops at the first entry at/older than the cutoff', async () => {
    vi.mocked(forgeRequest).mockResolvedValue({
      results: [v('2026-07-17T00:00:00Z'), v('2026-07-15T00:00:00Z'), v('2026-07-09T00:00:00Z'), v('2026-07-01T00:00:00Z')],
      _links: {},
    })
    await expect(countVersionsSince('p1', CUTOFF)).resolves.toBe(2)
    expect(forgeRequest).toHaveBeenCalledWith('/wiki/api/v2/pages/p1/versions?limit=50')
  })

  it('follows _links.next only when a full page is exhausted', async () => {
    vi.mocked(forgeRequest)
      .mockResolvedValueOnce({
        results: [v('2026-07-17T00:00:00Z'), v('2026-07-16T00:00:00Z')],
        _links: { next: '/wiki/api/v2/pages/p1/versions?limit=50&cursor=abc' },
      })
      .mockResolvedValueOnce({
        results: [v('2026-07-01T00:00:00Z')],
        _links: {},
      })
    await expect(countVersionsSince('p1', CUTOFF)).resolves.toBe(2)
    expect(forgeRequest).toHaveBeenCalledTimes(2)
    expect(forgeRequest).toHaveBeenLastCalledWith('/wiki/api/v2/pages/p1/versions?limit=50&cursor=abc')
  })

  it('getDrift caches per (pageId, pageVersion)', async () => {
    vi.mocked(forgeRequest).mockResolvedValue({
      results: [v('2026-07-17T00:00:00Z')],
      _links: {},
    })
    await expect(getDrift('p1', 7, CUTOFF)).resolves.toBe(1)
    await expect(getDrift('p1', 7, CUTOFF)).resolves.toBe(1)
    expect(forgeRequest).toHaveBeenCalledTimes(1)
    await expect(getDrift('p1', 8, CUTOFF)).resolves.toBe(1)
    expect(forgeRequest).toHaveBeenCalledTimes(2)
  })

  it('never throws: fetch failure resolves to 0', async () => {
    vi.mocked(forgeRequest).mockRejectedValue(new Error('boom'))
    await expect(countVersionsSince('p1', CUTOFF)).resolves.toBe(0)
  })
})
