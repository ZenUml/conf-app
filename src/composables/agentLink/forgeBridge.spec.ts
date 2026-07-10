import { describe, it, expect, vi, beforeEach } from 'vitest'
import ApWrapper2 from '@/model/ApWrapper2'
import { forgeRequest } from '@/utils/requestUtil'
import { createForgeAgentLinkBridge } from './forgeBridge'

// Same mocking pattern as ApWrapper2.spec.ts / CustomContentStorageProvider.spec.ts:
// construct a real ApWrapper2 and stub only the transport (forgeRequest) + the
// AtlasPage helpers it delegates to internally — everything else (custom-content
// v2 body shape, status/version handling, create-vs-update branching) runs for
// real, so these tests exercise the actual store contract, not a re-description
// of it.
vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  addonKey: 'test-addon',
}))

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn(),
  loadAllPaginatedData: vi.fn(),
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: true,
    forgeContext: null,
    zenumlRemoteBaseUrl: 'https://example.com',
  },
}))

vi.mock('@forge/bridge', () => ({
  requestConfluence: vi.fn(),
}))

vi.mock('@/model/page/AtlasPage', () => ({
  AtlasPage: vi.fn().mockImplementation(() => ({
    getPageId: vi.fn().mockResolvedValue(PAGE_ID),
    countMacros: vi.fn().mockResolvedValue(1),
  })),
}))

const PAGE_ID = '456'
const CONTENT_ID = '999'

function mockRoutes(overrides: {
  pageStatus?: any
  draftPageBody?: any
  pageBody?: any
  customContent?: any
  putResponse?: any
  putShouldReject?: Error
} = {}) {
  const calls: Array<{ url: string; method?: string; data?: any }> = []
  vi.mocked(forgeRequest).mockImplementation(async (url: string, method = 'GET', data: any = undefined) => {
    calls.push({ url, method, data })

    // Previous readPage path: GET /wiki/api/v2/pages/{pageId}?body-format=export_view&get-draft=true.
    if (url === `/wiki/api/v2/pages/${PAGE_ID}?body-format=export_view&get-draft=true`) {
      return overrides.draftPageBody ?? { title: '', body: { export_view: { value: '' } } }
    }
    // Current readPage path: Forge iframe-safe published v2 page body read.
    if (url === `/wiki/api/v2/pages/${PAGE_ID}?body-format=export_view`) {
      return overrides.pageBody ?? { title: 'My Page', body: { export_view: { value: '<p>Hello <b>world</b></p>' } } }
    }
    // getCustomContentForCurrentPage()'s historical-version check: GET /wiki/api/v2/pages/{pageId}
    if (url === `/wiki/api/v2/pages/${PAGE_ID}`) {
      return overrides.pageStatus ?? { status: 'current' }
    }
    // getCustomContentByIdV2 / fetchCustomContentByIdV2WithStatus:
    // GET /wiki/api/v2/custom-content/{id}?body-format=raw
    if (url === `/wiki/api/v2/custom-content/${CONTENT_ID}?body-format=raw` && method === 'GET') {
      return overrides.customContent ?? {
        id: CONTENT_ID,
        pageId: PAGE_ID,
        status: 'current',
        title: 'My Diagram',
        body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'A->B: hi', title: 'My Diagram' }) } },
        version: { number: 3, createdAt: '2026-01-01', authorId: 'user1' },
      }
    }
    // updateCustomContentV2: PUT /wiki/api/v2/custom-content/{id}
    if (url === `/wiki/api/v2/custom-content/${CONTENT_ID}` && method === 'PUT') {
      if (overrides.putShouldReject) throw overrides.putShouldReject
      return overrides.putResponse ?? { id: CONTENT_ID, version: { number: 4 } }
    }
    throw new Error(`Unexpected forgeRequest call: ${method} ${url}`)
  })
  return calls
}

describe('createForgeAgentLinkBridge', () => {
  let apWrapper: ApWrapper2

  beforeEach(() => {
    vi.clearAllMocks()
    apWrapper = new ApWrapper2()
  })

  describe('readPage', () => {
    it('issues the Forge iframe-safe v2 pages GET and maps title/pageId/plain-text body', async () => {
      const calls = mockRoutes()
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.readPage()

      expect(calls.some(c => c.url === `/wiki/api/v2/pages/${PAGE_ID}?body-format=export_view` && c.method === 'GET')).toBe(true)
      expect(calls.some(c => c.url.includes('get-draft=true'))).toBe(false)
      expect(result).toEqual({ pageId: PAGE_ID, title: 'My Page', text: 'Hello world' })
    })

    it('does not return the empty draft-body response when the published page has title and text', async () => {
      mockRoutes({
        draftPageBody: { title: '', body: { export_view: { value: '' } } },
        pageBody: {
          title: 'Live Page',
          body: { export_view: { value: '<h1>Intro</h1><p>Real page content</p>' } },
        },
      })
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.readPage()

      expect(result).toEqual({
        pageId: PAGE_ID,
        title: 'Live Page',
        text: 'Intro Real page content',
      })
    })

    it('strips scripts/styles and decodes entities', async () => {
      mockRoutes({
        pageBody: {
          title: 'Entities',
          body: { export_view: { value: '<style>.x{color:red}</style><p>A &amp; B &lt;tag&gt;</p><script>evil()</script>' } },
        },
      })
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.readPage()

      expect(result.text).toBe('A & B <tag>')
    })
  })

  describe('readDiagram', () => {
    it('reads the custom content (raw fetch, no copy-detection) and returns dsl + title/pageId/version', async () => {
      const calls = mockRoutes()
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.readDiagram(CONTENT_ID)

      expect(calls.some(c => c.url === `/wiki/api/v2/custom-content/${CONTENT_ID}?body-format=raw` && c.method === 'GET')).toBe(true)
      // Raw read path (readDiagramForAgent) does NOT hit the current-page
      // historical check — that avoids a false cross-page duplication_detect
      // on a discovery read of content on another page.
      expect(calls.some(c => c.url === `/wiki/api/v2/pages/${PAGE_ID}`)).toBe(false)
      expect(result).toEqual({
        contentId: CONTENT_ID,
        diagramType: 'sequence',
        title: 'My Diagram',
        dsl: 'A->B: hi',
        pageId: PAGE_ID,
        version: 3,
      })
    })

    it('extracts the DSL from the field matching the diagram type (mermaid)', async () => {
      mockRoutes({
        customContent: {
          id: CONTENT_ID,
          pageId: PAGE_ID,
          status: 'current',
          title: 'Mermaid diagram',
          body: { raw: { value: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'graph TD; A-->B' }) } },
          version: { number: 1, createdAt: '2026-01-01', authorId: 'user1' },
        },
      })
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.readDiagram(CONTENT_ID)

      expect(result).toMatchObject({ contentId: CONTENT_ID, diagramType: 'mermaid', dsl: 'graph TD; A-->B', title: 'Mermaid diagram' })
    })

    it('returns an Unknown-typed empty result when the content is not readable', async () => {
      mockRoutes({ customContent: { errors: [{ status: 404, code: 'NOT_FOUND' }] } })
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.readDiagram(CONTENT_ID)

      expect(result).toEqual({ contentId: CONTENT_ID, diagramType: 'unknown', title: '', dsl: '' })
    })
  })

  // The executor: search→rows mapping, exact-type post-filter, and limit are
  // tested against a MOCKED ApWrapper2.searchDiagramsForge (the CQL primitive),
  // so this isolates the executor logic from live CQL/Confluence.
  describe('searchDiagrams / listDiagrams (discovery executor)', () => {
    const hit = (over: Partial<import('@/model/ApWrapper2').DiagramSearchHit>) => ({
      contentId: 'c', title: 'T', diagramType: 'sequence', spaceKey: 'ENG', pageId: 'p1', excerpt: 'e', lastModified: 'now',
      ...over,
    })

    it('maps hits to rows and forwards query/spaceKey to searchDiagramsForge', async () => {
      const spy = vi.spyOn(apWrapper, 'searchDiagramsForge').mockResolvedValue([
        hit({ contentId: 'a', title: 'Checkout flow', diagramType: 'sequence' }),
      ])
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const rows = await bridge.searchDiagrams({ query: 'payment', spaceKey: 'ENG' })

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'payment', spaceKey: 'ENG' }),
      )
      expect(rows).toEqual([
        { contentId: 'a', title: 'Checkout flow', diagramType: 'sequence', spaceKey: 'ENG', pageId: 'p1', excerpt: 'e', lastModified: 'now' },
      ])
    })

    it('applies the exact diagramType post-filter (sequence-family share one content type)', async () => {
      vi.spyOn(apWrapper, 'searchDiagramsForge').mockResolvedValue([
        hit({ contentId: 'a', diagramType: 'sequence' }),
        hit({ contentId: 'b', diagramType: 'OpenAPI' }),
        hit({ contentId: 'c', diagramType: 'plantuml' }),
      ])
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const rows = await bridge.searchDiagrams({ query: 'x', types: ['openapi'] })

      expect(rows.map(r => r.contentId)).toEqual(['b'])
    })

    it('truncates to the requested limit', async () => {
      vi.spyOn(apWrapper, 'searchDiagramsForge').mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => hit({ contentId: `c${i}` })),
      )
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const rows = await bridge.searchDiagrams({ query: 'x', limit: 3 })

      expect(rows).toHaveLength(3)
    })

    it('listDiagrams runs without a query and applies the pageId post-filter', async () => {
      const spy = vi.spyOn(apWrapper, 'searchDiagramsForge').mockResolvedValue([
        hit({ contentId: 'a', pageId: 'p1' }),
        hit({ contentId: 'b', pageId: 'p2' }),
      ])
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const rows = await bridge.listDiagrams({ spaceKey: 'ENG', pageId: 'p2' })

      // No query forwarded (list is recency-only).
      expect(spy.mock.calls[0][0].query).toBeUndefined()
      expect(rows.map(r => r.contentId)).toEqual(['b'])
    })
  })

  describe('writeDiagram', () => {
    it('builds the v2 PUT body with status:"current" and an incremented version, and returns {ok, version, rendered:true}', async () => {
      const calls = mockRoutes()
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.writeDiagram(CONTENT_ID, 'A->B: updated')

      const put = calls.find(c => c.url === `/wiki/api/v2/custom-content/${CONTENT_ID}` && c.method === 'PUT')
      expect(put).toBeDefined()
      expect(put!.data.status).toBe('current')
      expect(put!.data.version).toEqual({ number: 4 }) // existing version 3 + 1
      expect(JSON.parse(put!.data.body.value).code).toBe('A->B: updated')
      expect(put!.data.body.representation).toBe('raw')

      expect(result).toEqual({ ok: true, version: 4, rendered: true })
    })

    it('returns {ok:false} and surfaces the error when the persist call fails', async () => {
      mockRoutes({ putShouldReject: new Error('boom') })
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.writeDiagram(CONTENT_ID, 'A->B: updated')

      expect(result).toEqual({ ok: false })
    })

    it('returns {ok:false} when the bound content id does not resolve to a diagram', async () => {
      mockRoutes({
        customContent: { errors: [{ status: 404, code: 'NOT_FOUND' }] },
      })
      const bridge = createForgeAgentLinkBridge({ apWrapper })

      const result = await bridge.writeDiagram(CONTENT_ID, 'A->B: updated')

      expect(result).toEqual({ ok: false })
    })
  })
})
