import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))

import { callRemote } from '@/utils/requestUtil'
import { getRelatedDiagrams, RelatedLookupError } from './ArchitectureTokens'

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

  it("sends the reader's page so the nearest position survives the backend's slice", async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({ indexedAt: null, contentVersion: null, participants: [] })
    await getRelatedDiagrams('42', { pageId: '77' })
    expect(callRemote).toHaveBeenCalledWith(
      '/api/architecture-tokens/related?customContentId=42&pageId=77',
      'GET',
    )
  })

  it('times out into a rejected promise tagged timeout', async () => {
    vi.mocked(callRemote).mockImplementationOnce(() => new Promise(() => {}))

    await expect(getRelatedDiagrams('42', { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  // callRemote throws Error('HTTP <status>: <body>') with `.status` for any non-2xx answer.
  // The footer used to record every such throw as `network`, which hid 19,057 guest 403s
  // behind a word that means "the request never got an answer".
  describe('classifies a thrown HTTP error by its status', () => {
    // the message is what callRemote really produces: `HTTP <status>: <body as JSON>`
    const httpError = (status: number, body?: unknown) =>
      Object.assign(new Error(`HTTP ${status}: ${body === undefined ? 'No body' : JSON.stringify(body)}`), { status })

    it('403 with body no_user_credential is no_user_credential', async () => {
      vi.mocked(callRemote).mockRejectedValueOnce(httpError(403, { error: 'no_user_credential' }))
      const error = await getRelatedDiagrams('42').catch((e) => e)
      expect(error).toBeInstanceOf(RelatedLookupError)
      expect(error).toMatchObject({ kind: 'no_user_credential', httpStatus: 403 })
    })

    it.each([
      [403, { error: 'forbidden' }],
      [401, { error: 'unauthorized' }],
      [500, { error: 'boom' }],
      [429, undefined],
      // the credential words under another status are not the guest answer
      [500, { error: 'no_user_credential' }],
    ])('%i without the 403 credential body is http_error carrying the status', async (status, body) => {
      vi.mocked(callRemote).mockRejectedValueOnce(httpError(status, body))
      await expect(getRelatedDiagrams('42')).rejects.toMatchObject({ kind: 'http_error', httpStatus: status })
    })

    it('an error with no status is network', async () => {
      vi.mocked(callRemote).mockRejectedValueOnce(new TypeError('Failed to fetch'))
      const error = await getRelatedDiagrams('42').catch((e) => e)
      expect(error).toMatchObject({ kind: 'network' })
      expect(error.httpStatus).toBeUndefined()
    })
  })
})
