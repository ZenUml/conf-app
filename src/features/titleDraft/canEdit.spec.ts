import { describe, it, expect, beforeEach, vi } from 'vitest'
import { canEditPage } from './canEdit'

const requestConfluence = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ requestConfluence }))
const res = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

describe('canEditPage', () => {
  beforeEach(() => requestConfluence.mockReset())

  it('posts the permission check for the update operation', async () => {
    requestConfluence.mockResolvedValueOnce(res(200, { hasPermission: true }))
    expect(await canEditPage('p1', 'acc-1')).toBe(true)
    const [url, opts] = requestConfluence.mock.calls[0]
    expect(url).toBe('/wiki/rest/api/content/p1/permission/check')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ subject: { type: 'user', identifier: 'acc-1' }, operation: 'update' })
  })
  it('is false when hasPermission is false, missing or not exactly true', async () => {
    for (const body of [{ hasPermission: false }, {}, { hasPermission: 'true' }, null]) {
      requestConfluence.mockResolvedValueOnce(res(200, body))
      expect(await canEditPage('p1', 'acc-1')).toBe(false)
    }
  })
  it('is false on a non-OK response or a throw', async () => {
    requestConfluence.mockResolvedValueOnce(res(403, { hasPermission: true }))
    expect(await canEditPage('p1', 'acc-1')).toBe(false)
    requestConfluence.mockRejectedValueOnce(new Error('boom'))
    expect(await canEditPage('p1', 'acc-1')).toBe(false)
  })
})
