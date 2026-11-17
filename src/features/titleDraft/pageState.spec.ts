import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TITLE_DRAFT_PROPERTY_KEY,
  titleDraftPropertyKeyFor,
  readTitleDraftRecord,
  writeAddedRecord,
  deleteTitleDraftRecord,
} from './pageState'

const requestConfluence = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ requestConfluence }))

const res = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const RECORD = { state: 'added', contentId: '5551', source: 'title-draft', at: 1700000000000 }
const found = (value: unknown = RECORD, version = 2) =>
  res(200, { results: [{ id: '77', version: { number: version }, key: TITLE_DRAFT_PROPERTY_KEY, value }] })
const absent = () => res(200, { results: [] })
const callsTo = (method: string) => requestConfluence.mock.calls.filter(([, o]) => o?.method === method)

describe('title draft page state', () => {
  beforeEach(() => requestConfluence.mockReset())

  it('derives a variant-suffixed key', () => {
    expect(titleDraftPropertyKeyFor('lite')).toBe('zenuml-title-draft-lite')
    expect(titleDraftPropertyKeyFor('asyncapi')).toBe('zenuml-title-draft-asyncapi')
    expect(titleDraftPropertyKeyFor('full')).toBe('zenuml-title-draft')
    expect(titleDraftPropertyKeyFor(undefined)).toBe('zenuml-title-draft')
  })

  describe('readTitleDraftRecord', () => {
    it('returns the record when present', async () => {
      requestConfluence.mockResolvedValueOnce(found())
      expect(await readTitleDraftRecord('p1')).toEqual(RECORD)
      expect(requestConfluence.mock.calls[0][0]).toContain(`/wiki/api/v2/pages/p1/properties?key=${TITLE_DRAFT_PROPERTY_KEY}`)
    })
    it('returns null when absent', async () => {
      requestConfluence.mockResolvedValueOnce(absent())
      expect(await readTitleDraftRecord('p1')).toBeNull()
    })
    it.each([403, 404, 500])('returns {unknown:true} on HTTP %i', async status => {
      requestConfluence.mockResolvedValueOnce(res(status))
      expect(await readTitleDraftRecord('p1')).toEqual({ unknown: true })
    })
    it('returns {unknown:true} on a throw or a malformed value', async () => {
      requestConfluence.mockRejectedValueOnce(new Error('boom'))
      expect(await readTitleDraftRecord('p1')).toEqual({ unknown: true })
      requestConfluence.mockResolvedValueOnce(found({ state: 'added' }))
      expect(await readTitleDraftRecord('p1')).toEqual({ unknown: true })
    })
  })

  describe('writeAddedRecord', () => {
    it('POSTs a new property when absent', async () => {
      requestConfluence.mockResolvedValueOnce(absent()).mockResolvedValueOnce(res(200, {}))
      expect(await writeAddedRecord('p1', '5551', 1700000000000)).toBe('written')
      const [url, opts] = callsTo('POST')[0]
      expect(url).toBe('/wiki/api/v2/pages/p1/properties')
      expect(JSON.parse(opts.body)).toEqual({ key: TITLE_DRAFT_PROPERTY_KEY, value: RECORD })
    })
    it('PUTs version+1 when a property exists', async () => {
      requestConfluence.mockResolvedValueOnce(found(RECORD, 4)).mockResolvedValueOnce(res(200, {}))
      expect(await writeAddedRecord('p1', '5551', 1700000000000)).toBe('written')
      const [url, opts] = callsTo('PUT')[0]
      expect(url).toBe('/wiki/api/v2/pages/p1/properties/77')
      expect(JSON.parse(opts.body).version.number).toBe(5)
    })
    it('maps 403 to forbidden and other failures to failed, never throwing', async () => {
      requestConfluence.mockResolvedValueOnce(absent()).mockResolvedValueOnce(res(403))
      expect(await writeAddedRecord('p1', '1')).toBe('forbidden')
      requestConfluence.mockResolvedValueOnce(absent()).mockResolvedValueOnce(res(500))
      expect(await writeAddedRecord('p1', '1')).toBe('failed')
      requestConfluence.mockRejectedValueOnce(new Error('boom'))
      expect(await writeAddedRecord('p1', '1')).toBe('failed')
    })
  })

  describe('deleteTitleDraftRecord', () => {
    it('deletes the property by id', async () => {
      requestConfluence.mockResolvedValueOnce(found()).mockResolvedValueOnce(res(204))
      expect(await deleteTitleDraftRecord('p1')).toBe('deleted')
      expect(callsTo('DELETE')[0][0]).toBe('/wiki/api/v2/pages/p1/properties/77')
    })
    it('is a no-op when absent, and treats 404 as deleted', async () => {
      requestConfluence.mockResolvedValueOnce(absent())
      expect(await deleteTitleDraftRecord('p1')).toBe('unchanged')
      expect(callsTo('DELETE')).toHaveLength(0)
      requestConfluence.mockResolvedValueOnce(found()).mockResolvedValueOnce(res(404))
      expect(await deleteTitleDraftRecord('p1')).toBe('deleted')
    })
    it('reports failed when the record cannot be read or deleting throws', async () => {
      requestConfluence.mockResolvedValueOnce(res(500))
      expect(await deleteTitleDraftRecord('p1')).toBe('failed')
      requestConfluence.mockResolvedValueOnce(found()).mockRejectedValueOnce(new Error('x'))
      expect(await deleteTitleDraftRecord('p1')).toBe('failed')
    })
  })
})
