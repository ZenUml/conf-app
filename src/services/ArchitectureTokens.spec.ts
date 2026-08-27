import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))

import { callRemote } from '@/utils/requestUtil'
import { getRelatedDiagrams } from './ArchitectureTokens'

describe('getRelatedDiagrams', () => {
  it('GETs the related route with the encoded id', async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({
      indexedAt: null,
      contentVersion: null,
      participants: [],
    })

    await getRelatedDiagrams('42')

    expect(callRemote).toHaveBeenCalledWith(
      '/api/architecture-tokens/related?customContentId=42',
      'GET',
    )
  })

  it('times out into a rejected promise tagged timeout', async () => {
    vi.mocked(callRemote).mockImplementationOnce(() => new Promise(() => {}))

    await expect(getRelatedDiagrams('42', 10)).rejects.toMatchObject({ kind: 'timeout' })
  })
})
