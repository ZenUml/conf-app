import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
import { callRemote } from '@/utils/requestUtil'
import { getSpaceStatuses } from './spaceStatuses'

describe('dashboard paid-status batch', () => {
  beforeEach(() => vi.mocked(callRemote).mockReset())
  it('uses the authenticated endpoint and handles a one-row response', async () => {
    vi.mocked(callRemote).mockResolvedValue({ isPaid: false, decisionKnown: true })
    expect(await getSpaceStatuses(['~abc'])).toEqual({ '~abc': { isPaid: false, decisionKnown: true } })
    expect(callRemote).toHaveBeenCalledWith('/api/space-status?spaceKey=~abc', 'GET')
  })
  it('chunks beyond 200 without dropping the last row', async () => {
    const keys = Array.from({ length: 201 }, (_, i) => `S${i}`)
    vi.mocked(callRemote).mockResolvedValueOnce({ statuses: Object.fromEntries(keys.slice(0, 200).map(key => [key, { isPaid: false, decisionKnown: true }])) }).mockResolvedValueOnce({ isPaid: true, decisionKnown: true })
    const result = await getSpaceStatuses(keys)
    expect(Object.keys(result)).toHaveLength(201)
    expect(result.S200).toEqual({ isPaid: true, decisionKnown: true })
    expect(callRemote).toHaveBeenCalledTimes(2)
  })
  it('does not treat malformed or older decisions as unpaid', async () => {
    vi.mocked(callRemote).mockResolvedValue({ statuses: { ENG: { isPaid: false }, OPS: { isPaid: 'false', decisionKnown: true } } })
    expect(await getSpaceStatuses(['ENG', 'OPS'])).toEqual({})
    vi.mocked(callRemote).mockResolvedValue('<html>')
    await expect(getSpaceStatuses(['ENG', 'OPS'])).rejects.toThrow('Paid status unavailable')
  })
})
