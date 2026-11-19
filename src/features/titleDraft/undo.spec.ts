import { describe, it, expect, beforeEach, vi } from 'vitest'
import { undoTitleDraft, discardCustomContent } from './undo'
import forgeGlobal from '@/model/globals/forgeGlobal'

const requestConfluence = vi.hoisted(() => vi.fn())
const deleteRecord = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ requestConfluence }))
vi.mock('./pageState', () => ({ deleteTitleDraftRecord: deleteRecord }))

const res = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const pageWith = (content: unknown[], version = 5) =>
  res(200, {
    id: 'page-1',
    title: 'Checkout retry design',
    version: { number: version },
    body: { atlas_doc_format: { value: JSON.stringify({ version: 1, type: 'doc', content }) } },
  })
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const macro = (id: string) => ({ type: 'extension', attrs: { parameters: { guestParams: { customContentId: id } } } })
const calls = (method: string) => requestConfluence.mock.calls.filter(([, o]) => o?.method === method)

describe('undoTitleDraft', () => {
  beforeEach(() => {
    requestConfluence.mockReset()
    deleteRecord.mockReset().mockResolvedValue('deleted')
    ;(forgeGlobal as any).forgeContext = { cloudId: 'cloud-1' }
  })

  it('removes only the matching node, writes one version, clears the record, discards the content', async () => {
    requestConfluence
      .mockResolvedValueOnce(pageWith([macro('42'), para('a'), macro('43')]))
      .mockResolvedValueOnce(res(200, {}))
      .mockResolvedValueOnce(res(204))
    expect(await undoTitleDraft('page-1', '42')).toEqual({ result: 'undone' })
    const put = calls('PUT')
    expect(put).toHaveLength(1)
    const body = JSON.parse(put[0][1].body)
    expect(body.version).toEqual({ number: 6, message: 'Removed the ZenUML diagram added from the page title' })
    expect(JSON.parse(body.body.value).content).toEqual([para('a'), macro('43')])
    expect(deleteRecord).toHaveBeenCalledWith('page-1')
    expect(calls('DELETE')[0][0]).toBe('/wiki/api/v2/custom-content/42')
  })

  it('returns not_found with no PUT when the node is gone', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([para('a'), macro('43')]))
    expect(await undoTitleDraft('page-1', '42')).toEqual({ result: 'not_found' })
    expect(calls('PUT')).toHaveLength(0)
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('retries once on 409 then gives conflict', async () => {
    requestConfluence
      .mockResolvedValueOnce(pageWith([macro('42')]))
      .mockResolvedValueOnce(res(409))
      .mockResolvedValueOnce(pageWith([macro('42')], 6))
      .mockResolvedValueOnce(res(200, {}))
      .mockResolvedValueOnce(res(204))
    expect((await undoTitleDraft('page-1', '42')).result).toBe('undone')
    requestConfluence.mockReset()
    requestConfluence
      .mockResolvedValueOnce(pageWith([macro('42')]))
      .mockResolvedValueOnce(res(409))
      .mockResolvedValueOnce(pageWith([macro('42')], 6))
      .mockResolvedValueOnce(res(409))
    expect((await undoTitleDraft('page-1', '42')).result).toBe('conflict')
    expect(deleteRecord).toHaveBeenCalledTimes(1)
  })

  it('maps 403 to forbidden and other errors to failed', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([macro('42')])).mockResolvedValueOnce(res(403))
    expect((await undoTitleDraft('page-1', '42')).result).toBe('forbidden')
    requestConfluence.mockResolvedValueOnce(pageWith([macro('42')])).mockResolvedValueOnce(res(500))
    expect((await undoTitleDraft('page-1', '42')).result).toBe('failed')
    requestConfluence.mockRejectedValueOnce(new Error('boom'))
    expect((await undoTitleDraft('page-1', '42')).result).toBe('failed')
  })

  it('still reports undone when clearing the record or discarding throws', async () => {
    deleteRecord.mockRejectedValueOnce(new Error('x'))
    requestConfluence
      .mockResolvedValueOnce(pageWith([macro('42')]))
      .mockResolvedValueOnce(res(200, {}))
      .mockRejectedValueOnce(new Error('y'))
    expect((await undoTitleDraft('page-1', '42')).result).toBe('undone')
  })
})

describe('discardCustomContent', () => {
  beforeEach(() => requestConfluence.mockReset())
  it('DELETEs the custom content and never throws', async () => {
    requestConfluence.mockResolvedValueOnce(res(204))
    await expect(discardCustomContent('42')).resolves.toBeUndefined()
    expect(calls('DELETE')[0][0]).toBe('/wiki/api/v2/custom-content/42')
    requestConfluence.mockRejectedValueOnce(new Error('boom'))
    await expect(discardCustomContent('42')).resolves.toBeUndefined()
  })
})
