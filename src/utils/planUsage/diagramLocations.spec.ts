import { describe, expect, it } from 'vitest'
import { ForgeRequestError } from '@/utils/forgeRequestError'
import { DiagramType } from '@/model/Diagram/Diagram'
import {
  describeAge,
  loadDiagramLocations,
  resolveSpaces,
  type ConfluenceGet,
} from './diagramLocations'

interface Route { match: string; status?: number; body?: any }

// A viewer-side Confluence GET: first matching substring wins, a 4xx/5xx route
// throws the same ForgeRequestError `confluenceGet` throws in production.
function fakeGet(routes: Route[]): ConfluenceGet & { calls: string[] } {
  const calls: string[] = []
  const get = (async (url: string) => {
    calls.push(url)
    const r = routes.find((x) => url.includes(x.match))
    if (!r) throw new Error(`no route for ${url}`)
    if (r.status && r.status >= 400) {
      throw new ForgeRequestError({ status: r.status, method: 'GET', url, contentType: 'application/json', body: '{}', nonJson: false })
    }
    return r.body
  }) as ConfluenceGet & { calls: string[] }
  get.calls = calls
  return get
}

const SEQ = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence'
const GRAPH = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph'
const TYPES = [SEQ, GRAPH]
const BASE = 'https://example.atlassian.net/wiki'
const SPACE = { id: '301', key: 'ENG', name: 'Engineering' }

function item(over: Record<string, unknown> = {}) {
  return {
    id: '1001',
    type: SEQ,
    title: 'Checkout flow',
    pageId: '201',
    spaceId: '301',
    version: { number: 3, createdAt: '2026-10-20T01:02:03.000Z' },
    body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B' }) } },
    ...over,
  }
}

function page(id: string, title: string) {
  return { id, title, _links: { webui: `/spaces/ENG/pages/${id}/${encodeURIComponent(title)}` } }
}

describe('resolveSpaces', () => {
  it('returns id, key and name for the spaces the viewer can see, in the requested order, in one bulk call', async () => {
    const get = fakeGet([{
      match: '/api/v2/spaces?keys=OPS,ENG,HR&limit=250',
      body: { results: [{ id: 301, key: 'ENG', name: 'Engineering' }, { id: 302, key: 'OPS', name: 'Operations' }] },
    }])
    await expect(resolveSpaces(get, ['OPS', 'ENG', 'HR', 'ENG'])).resolves.toEqual([
      { id: '302', key: 'OPS', name: 'Operations' },
      { id: '301', key: 'ENG', name: 'Engineering' },
    ])
    expect(get.calls).toHaveLength(1)
  })

  it('splits more than 250 keys across calls', async () => {
    const keys = Array.from({ length: 260 }, (_, i) => `S${i}`)
    const get = fakeGet([{ match: '/api/v2/spaces?keys=', body: { results: [{ id: 1, key: 'S0', name: 'Zero' }] } }])
    await expect(resolveSpaces(get, keys)).resolves.toEqual([{ id: '1', key: 'S0', name: 'Zero' }])
    expect(get.calls).toHaveLength(2)
  })

  it('resolves nothing on a 403 or 404 and rethrows anything else', async () => {
    await expect(resolveSpaces(fakeGet([{ match: '/api/v2/spaces?keys=', status: 403 }]), ['HR'])).resolves.toEqual([])
    await expect(resolveSpaces(fakeGet([{ match: '/api/v2/spaces?keys=', status: 404 }]), ['HR'])).resolves.toEqual([])
    await expect(resolveSpaces(fakeGet([{ match: '/api/v2/spaces?keys=', status: 500 }]), ['HR'])).rejects.toBeInstanceOf(ForgeRequestError)
  })

  it('makes no call for an empty key list', async () => {
    const get = fakeGet([])
    await expect(resolveSpaces(get, [])).resolves.toEqual([])
    expect(get.calls).toHaveLength(0)
  })
})

describe('loadDiagramLocations', () => {
  it('lists one batch: readable pages become rows, unreadable parents are counted as hidden', async () => {
    const get = fakeGet([
      {
        match: `/api/v2/spaces/301/custom-content?type=${encodeURIComponent(SEQ)}`,
        body: {
          results: [
            item(),
            item({ id: '1002', title: 'Deploy pipeline', pageId: '202', body: { raw: { value: JSON.stringify({ diagramType: 'mermaid' }) } } }),
            item({ id: '1003', title: 'Restricted', pageId: '299' }),
          ],
          _links: { next: `/wiki/api/v2/spaces/301/custom-content?cursor=abc&type=${encodeURIComponent(SEQ)}&limit=25` },
        },
      },
      { match: '/api/v2/pages?id=201&id=202&id=299', body: { results: [page('201', 'Checkout'), page('202', 'Release process')], _links: { base: BASE } } },
    ])

    const batch = await loadDiagramLocations(get, { space: SPACE, types: TYPES, now: () => new Date('2026-10-23T02:00:00.000Z') })

    expect(batch.outcome).toBe('ok')
    expect(batch.fetchedAt).toBe('2026-10-23T02:00:00.000Z')
    expect(batch.hiddenCount).toBe(1)
    expect(batch.rows).toEqual([
      {
        contentId: '1001', diagramTitle: 'Checkout flow', spaceKey: 'ENG', spaceName: 'Engineering',
        diagramType: 'sequence', macroType: 'sequence',
        containerKind: 'page', pageId: '201', pageTitle: 'Checkout',
        pageUrl: `${BASE}/spaces/ENG/pages/201/Checkout`, updatedAt: '2026-10-20T01:02:03.000Z',
      },
      {
        contentId: '1002', diagramTitle: 'Deploy pipeline', spaceKey: 'ENG', spaceName: 'Engineering',
        diagramType: 'mermaid', macroType: 'mermaid',
        containerKind: 'page', pageId: '202', pageTitle: 'Release process',
        pageUrl: `${BASE}/spaces/ENG/pages/202/Release%20process`, updatedAt: '2026-10-20T01:02:03.000Z',
      },
    ])
    // Confluence's own next link, with the /wiki prefix the bridge path must not carry.
    expect(batch.next).toEqual({ typeIndex: 0, nextUrl: `/api/v2/spaces/301/custom-content?cursor=abc&type=${encodeURIComponent(SEQ)}&limit=25` })
    expect(get.calls[0]).toBe(`/api/v2/spaces/301/custom-content?type=${encodeURIComponent(SEQ)}&body-format=raw&limit=25`)
  })

  it('continues from a cursor and moves to the next content type when a type is exhausted', async () => {
    const nextUrl = `/api/v2/spaces/301/custom-content?cursor=abc&type=${encodeURIComponent(SEQ)}&limit=25`
    const get = fakeGet([
      { match: 'cursor=abc', body: { results: [item({ id: '1004', pageId: '204' })], _links: {} } },
      { match: '/api/v2/pages?id=204', body: { results: [page('204', 'Four')], _links: { base: BASE } } },
    ])
    const batch = await loadDiagramLocations(get, { space: SPACE, types: TYPES, cursor: { typeIndex: 0, nextUrl } })
    expect(get.calls[0]).toBe(nextUrl)
    expect(batch.rows.map((r) => r.contentId)).toEqual(['1004'])
    expect(batch.next).toEqual({ typeIndex: 1, nextUrl: null })
  })

  it('skips a content type with no records inside the same call, so a batch with a next link is never empty', async () => {
    const get = fakeGet([
      { match: `type=${encodeURIComponent(SEQ)}`, body: { results: [] } },
      { match: `type=${encodeURIComponent(GRAPH)}`, body: { results: [item({ id: '2001', type: GRAPH, pageId: '205', body: { raw: { value: JSON.stringify({ diagramType: 'graph' }) } } })] } },
      { match: '/api/v2/pages?id=205', body: { results: [page('205', 'Network')], _links: { base: BASE } } },
    ])
    const batch = await loadDiagramLocations(get, { space: SPACE, types: TYPES })
    expect(get.calls.filter((u) => u.includes('custom-content'))).toHaveLength(2)
    expect(batch.rows.map((r) => r.diagramType)).toEqual(['graph'])
    expect(batch.next).toBeNull()
  })

  it('is empty, with no next, when every type is exhausted without records', async () => {
    const get = fakeGet([{ match: 'custom-content', body: { results: [] } }])
    const batch = await loadDiagramLocations(get, { space: SPACE, types: TYPES })
    expect(batch).toMatchObject({ outcome: 'empty', rows: [], hiddenCount: 0, next: null })
    expect(get.calls).toHaveLength(2)
  })

  it('is forbidden on a 403/404 and throws on any other failure', async () => {
    const forbidden = await loadDiagramLocations(fakeGet([{ match: 'custom-content', status: 403 }]), { space: SPACE, types: TYPES })
    expect(forbidden).toMatchObject({ outcome: 'forbidden', rows: [], next: null })
    await expect(loadDiagramLocations(fakeGet([{ match: 'custom-content', status: 500 }]), { space: SPACE, types: TYPES }))
      .rejects.toBeInstanceOf(ForgeRequestError)
  })

  it('resolves blog-post parents, keeps space-parented records as "not on a page", and tolerates unreadable bodies', async () => {
    const get = fakeGet([
      {
        match: 'custom-content',
        body: {
          results: [
            item({ id: '3001', pageId: undefined, blogPostId: '401' }),
            item({ id: '3002', pageId: undefined, spaceId: '301', body: { raw: { value: 'not json' } } }),
            item({ id: '3003', pageId: undefined, blogPostId: '499' }),
          ],
        },
      },
      { match: '/api/v2/blogposts?id=401&id=499', body: { results: [{ id: '401', title: 'Launch post', _links: { webui: '/spaces/ENG/blog/2026/10/01/401/Launch' } }], _links: { base: BASE } } },
    ])
    const batch = await loadDiagramLocations(get, { space: SPACE, types: [SEQ] })
    expect(batch.hiddenCount).toBe(1)
    expect(batch.rows).toMatchObject([
      { contentId: '3001', containerKind: 'blogpost', pageId: '401', pageTitle: 'Launch post', pageUrl: `${BASE}/spaces/ENG/blog/2026/10/01/401/Launch` },
      { contentId: '3002', containerKind: 'space', pageId: null, pageTitle: null, pageUrl: null, diagramType: DiagramType.Unknown, macroType: 'none' },
    ])
    expect(get.calls.some((u) => u.includes('/api/v2/pages?'))).toBe(false)
  })

  it('falls back to a site-relative page link when the bulk response carries no base', async () => {
    const get = fakeGet([
      { match: 'custom-content', body: { results: [item()] } },
      { match: '/api/v2/pages?id=201', body: { results: [page('201', 'Checkout')] } },
    ])
    const batch = await loadDiagramLocations(get, { space: SPACE, types: [SEQ] })
    expect(batch.rows[0].pageUrl).toBe('/wiki/spaces/ENG/pages/201/Checkout')
  })

  it('is empty without a request when the variant registers no content types', async () => {
    const get = fakeGet([])
    const batch = await loadDiagramLocations(get, { space: SPACE, types: [] })
    expect(batch).toMatchObject({ outcome: 'empty', rows: [], next: null })
    expect(get.calls).toHaveLength(0)
  })
})

describe('describeAge', () => {
  const now = new Date('2026-10-23T12:00:00.000Z')
  it.each([
    ['2026-10-23T11:59:40.000Z', 'just now'],
    ['2026-10-23T11:45:00.000Z', '15 min ago'],
    ['2026-10-23T09:00:00.000Z', '3 h ago'],
    ['2026-10-20T12:00:00.000Z', '3 d ago'],
  ])('%s → %s', (iso, expected) => {
    expect(describeAge(iso, now)).toBe(expected)
  })
  it('is unknown for a missing or unparseable stamp and a date past 30 days', () => {
    expect(describeAge(null, now)).toBe('unknown')
    expect(describeAge('nope', now)).toBe('unknown')
    expect(describeAge('2026-01-05T00:00:00.000Z', now)).toMatch(/2026/)
  })
})
