import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  persistUnplacedProperty,
  readUnplacedProperty,
  clearUnplacedProperty,
  MAX_PROPERTY_ENTRIES,
  UNPLACED_PROPERTY_KEY,
  unplacedPropertyKeyFor,
  unlistedCount,
} from './unplacedProperty'

const requestConfluence = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ requestConfluence }))

const ENTRY = { id: 'cc-1', title: 'Login flow', diagramType: 'sequence' }
const OTHER = { id: 'cc-2', title: 'Retry path', diagramType: 'mermaid' }
const NOW = Date.parse('2026-08-31T10:00:00.000Z')

/** What the v2 endpoint returns — shapes taken from the lite-stg round trip. */
const res = (status: number, body?: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})
const found = (entries: unknown[], version = 1, total?: number) =>
  res(200, {
    results: [
      {
        id: '9001',
        version: { number: version },
        key: UNPLACED_PROPERTY_KEY,
        value: { entries, ...(total === undefined ? {} : { total }), updatedAt: '2026-08-30T00:00:00.000Z' },
      },
    ],
  })
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `cc-${i}`, title: `D${i}`, diagramType: 'sequence' }))
const absent = () => res(200, { results: [] })

const callsTo = (method: string) =>
  requestConfluence.mock.calls.filter(([, opts]) => opts?.method === method)

describe('unplacedProperty — the cross-user store behind the displayConditions gate', () => {
  beforeEach(() => {
    requestConfluence.mockReset()
  })

  describe('reading', () => {
    it('reports absent for a 200 with no results — what the gate sees', async () => {
      requestConfluence.mockResolvedValueOnce(absent())
      expect(await readUnplacedProperty('page-1')).toEqual({ status: 'absent' })
    })

    it('does NOT collapse an unreachable page into "no unplaced diagrams"', async () => {
      // A 404 means we could not read the page at all. Treating it as absent
      // would let a caller delete state it never saw.
      requestConfluence.mockResolvedValueOnce(res(404))
      expect(await readUnplacedProperty('page-1')).toEqual({ status: 'error' })
    })

    it('distinguishes a permission denial from any other failure', async () => {
      requestConfluence.mockResolvedValueOnce(res(403))
      expect(await readUnplacedProperty('page-1')).toEqual({ status: 'forbidden' })
    })

    it('drops entries with no id and tolerates a missing title/type', async () => {
      requestConfluence.mockResolvedValueOnce(found([ENTRY, { title: 'orphan' }, { id: 'cc-9' }]))
      const read = await readUnplacedProperty('page-1')
      expect(read.status === 'ok' && read.value.entries).toEqual([
        ENTRY,
        { id: 'cc-9', title: '', diagramType: '' },
      ])
    })
  })

  describe('writing', () => {
    it('creates the property when the page has none', async () => {
      requestConfluence.mockResolvedValueOnce(absent()).mockResolvedValueOnce(res(200, {}))
      expect(await persistUnplacedProperty('page-1', [ENTRY], NOW)).toBe('written')

      const [url, opts] = callsTo('POST')[0]
      expect(url).toBe('/wiki/api/v2/pages/page-1/properties')
      expect(JSON.parse(opts.body)).toEqual({
        key: UNPLACED_PROPERTY_KEY,
        value: { entries: [ENTRY], total: 1, updatedAt: '2026-08-31T10:00:00.000Z' },
      })
    })

    it('updates with the next version number', async () => {
      requestConfluence.mockResolvedValueOnce(found([ENTRY], 3)).mockResolvedValueOnce(res(200, {}))
      expect(await persistUnplacedProperty('page-1', [ENTRY, OTHER], NOW)).toBe('written')

      const [url, opts] = callsTo('PUT')[0]
      expect(url).toBe('/wiki/api/v2/pages/page-1/properties/9001')
      expect(JSON.parse(opts.body).version).toEqual({ number: 4 })
    })

    it('writes nothing when the unplaced set has not moved', async () => {
      // The byline is reopened on unchanged pages constantly. A rewrite would
      // bump the version — and updatedAt scopes dismissals, so it would also
      // re-show the banner to someone who had dismissed it.
      requestConfluence.mockResolvedValueOnce(found([ENTRY]))
      expect(await persistUnplacedProperty('page-1', [ENTRY], NOW)).toBe('unchanged')
      expect(callsTo('PUT')).toHaveLength(0)
      expect(callsTo('POST')).toHaveLength(0)
    })

    it('ignores entry ORDER when deciding whether anything moved', async () => {
      requestConfluence.mockResolvedValueOnce(found([ENTRY, OTHER]))
      expect(await persistUnplacedProperty('page-1', [OTHER, ENTRY], NOW)).toBe('unchanged')
    })

    it('retries once against the fresh version after a 409', async () => {
      // Measured on lite-stg: a PUT with a stale version number returns 409.
      requestConfluence
        .mockResolvedValueOnce(found([ENTRY], 3))
        .mockResolvedValueOnce(res(409))
        .mockResolvedValueOnce(found([ENTRY], 7))
        .mockResolvedValueOnce(res(200, {}))

      expect(await persistUnplacedProperty('page-1', [OTHER], NOW)).toBe('written')
      expect(JSON.parse(callsTo('PUT')[1][1].body).version).toEqual({ number: 8 })
    })

    it('gives up rather than looping when the retry also conflicts', async () => {
      requestConfluence
        .mockResolvedValueOnce(found([ENTRY], 3))
        .mockResolvedValueOnce(res(409))
        .mockResolvedValueOnce(res(409))
      expect(await persistUnplacedProperty('page-1', [OTHER], NOW)).toBe('failed')
    })

    it('reports forbidden so the caller can fall back to the per-browser marker', async () => {
      requestConfluence.mockResolvedValueOnce(res(403))
      expect(await persistUnplacedProperty('page-1', [ENTRY], NOW)).toBe('forbidden')
    })

    it('refuses to write over a property it could not read', async () => {
      requestConfluence.mockResolvedValueOnce(res(500))
      expect(await persistUnplacedProperty('page-1', [ENTRY], NOW)).toBe('failed')
      expect(callsTo('POST')).toHaveLength(0)
      expect(callsTo('PUT')).toHaveLength(0)
    })

    it('caps how many entries travel in the property, but not the count', async () => {
      requestConfluence.mockResolvedValueOnce(absent()).mockResolvedValueOnce(res(200, {}))
      await persistUnplacedProperty('page-1', many(MAX_PROPERTY_ENTRIES + 5), NOW)

      const value = JSON.parse(callsTo('POST')[0][1].body).value
      expect(value.entries).toHaveLength(MAX_PROPERTY_ENTRIES)
      // The banner said "20 diagrams" on a page with 23 before the count travelled.
      expect(value.total).toBe(MAX_PROPERTY_ENTRIES + 5)
    })

    it('rewrites when only the count past the cap moved', async () => {
      // A diagram placed beyond the named twenty leaves the entries identical.
      const listed = many(MAX_PROPERTY_ENTRIES)
      requestConfluence
        .mockResolvedValueOnce(found(listed, 2, MAX_PROPERTY_ENTRIES + 3))
        .mockResolvedValueOnce(res(200, {}))
      expect(await persistUnplacedProperty('page-1', many(MAX_PROPERTY_ENTRIES + 2), NOW)).toBe('written')
      expect(JSON.parse(callsTo('PUT')[0][1].body).value.total).toBe(MAX_PROPERTY_ENTRIES + 2)
    })

    it('writes nothing when a record without a count already says the same', async () => {
      // Records written before `total` existed read as total = entries.length.
      requestConfluence.mockResolvedValueOnce(found([ENTRY, OTHER]))
      expect(await persistUnplacedProperty('page-1', [ENTRY, OTHER], NOW)).toBe('unchanged')
    })
  })

  describe('the count past the cap', () => {
    it('reads the stored total, and ignores one smaller than the names it carries', async () => {
      requestConfluence.mockResolvedValueOnce(found([ENTRY], 1, 23))
      const read = await readUnplacedProperty('page-1')
      expect(read.status === 'ok' && read.value.total).toBe(23)

      requestConfluence.mockResolvedValueOnce(found([ENTRY, OTHER], 1, 1))
      const bad = await readUnplacedProperty('page-1')
      expect(bad.status === 'ok' && bad.value.total).toBeUndefined()
    })

    it('counts what the record does not name', () => {
      expect(unlistedCount({ entries: many(20), total: 23 })).toBe(3)
      expect(unlistedCount({ entries: many(2) })).toBe(0)
    })
  })

  describe('clearing', () => {
    it('DELETES rather than writing an empty property — presence is the gate', async () => {
      // An empty property would keep booting a banner iframe on a page with
      // nothing left to say.
      requestConfluence.mockResolvedValueOnce(found([ENTRY])).mockResolvedValueOnce(res(204))
      expect(await persistUnplacedProperty('page-1', [], NOW)).toBe('deleted')

      expect(callsTo('DELETE')[0][0]).toBe('/wiki/api/v2/pages/page-1/properties/9001')
    })

    it('is a no-op when the page is already off the gate', async () => {
      requestConfluence.mockResolvedValueOnce(absent())
      expect(await persistUnplacedProperty('page-1', [], NOW)).toBe('unchanged')
      expect(callsTo('DELETE')).toHaveLength(0)
    })

    it('treats an already-deleted property as deleted', async () => {
      requestConfluence.mockResolvedValueOnce(found([ENTRY])).mockResolvedValueOnce(res(404))
      expect(await clearUnplacedProperty('page-1')).toBe('deleted')
    })

    it('reports forbidden when the reader cannot clear it', async () => {
      requestConfluence.mockResolvedValueOnce(found([ENTRY])).mockResolvedValueOnce(res(403))
      expect(await clearUnplacedProperty('page-1')).toBe('forbidden')
    })
  })

  it('never throws when the bridge itself rejects', async () => {
    requestConfluence.mockRejectedValue(new Error('bridge down'))
    expect(await persistUnplacedProperty('page-1', [ENTRY], NOW)).toBe('failed')
    expect(await clearUnplacedProperty('page-1')).toBe('failed')
  })
})

// Content properties are site-global across apps, so every app that ships the
// banner needs its own key — or one app's banner boots on another's diagrams.
describe('unplacedPropertyKeyFor', () => {
  it('gives Lite, Full and the AsyncAPI app distinct keys', () => {
    expect(unplacedPropertyKeyFor('lite')).toBe('zenuml-unplaced-diagrams-lite')
    expect(unplacedPropertyKeyFor('full')).toBe('zenuml-unplaced-diagrams')
    expect(unplacedPropertyKeyFor('asyncapi')).toBe('zenuml-unplaced-diagrams-asyncapi')
  })
})
