import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bootstrapForgeViewer: vi.fn(async () => undefined),
  ensureDrawioViewerLoaded: vi.fn(async () => undefined),
  getContext: vi.fn(async () => ({
    extension: {
      config: {
        customContentId: 'cc-board-1',
        graphEditorMode: 'board',
      },
    },
  })),
}))

const mockGlobals = vi.hoisted(() => ({
  apWrapper: {
    loadCustomContentWithOrphanRecovery: vi.fn(async () => ({
      customContent: {
        value: {
          diagramType: 'graph',
          graphXml: '<mxfile><diagram name="Diagram" /></mxfile>',
          boardGraphXml: '',
        },
      },
      probeResult: {},
    })),
  },
}))

vi.mock('@/utils/viewerBootstrap', () => ({
  bootstrapForgeViewer: h.bootstrapForgeViewer,
}))
vi.mock('@/utils/drawio/loadDrawioViewer', () => ({
  ensureDrawioViewerLoaded: h.ensureDrawioViewerLoaded,
}))
vi.mock('@/model/globals', () => ({ default: mockGlobals }))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { isForge: true, isLite: false, isDiagramly: false, isAsyncApi: false },
  getContext: h.getContext,
  openModal: vi.fn(),
}))
vi.mock('./EventBus', () => ({
  default: { $on: vi.fn() },
}))

describe('Forge graph viewer mode bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('passes the persisted Board mode into the mounted viewer', async () => {
    await import('./forge-graph-viewer')

    await vi.waitFor(() => expect(h.bootstrapForgeViewer).toHaveBeenCalled())
    expect(h.bootstrapForgeViewer).toHaveBeenCalledWith(expect.objectContaining({
      contentProps: { graphEditorMode: 'board' },
    }))
  })

  it('returns a real Board load failure from bootstrap instead of the Diagram document', async () => {
    await import('./forge-graph-viewer')

    await vi.waitFor(() => expect(h.bootstrapForgeViewer).toHaveBeenCalled())
    const [options] = h.bootstrapForgeViewer.mock.calls.at(-1) as any[]
    const result = await options.loadDiagram()

    expect(result).toMatchObject({
      loadError: {
        errorClass: 'malformed',
        errorCode: 'board_document_empty',
      },
    })
    // Keep the fetched Diagram object intact for diagnostics and to prove the
    // fail-fast path does not mutate or replace the legacy Diagram source.
    expect(result.doc).toMatchObject({
      graphXml: '<mxfile><diagram name="Diagram" /></mxfile>',
      boardGraphXml: '',
    })
  })

  it('reports malformed Board XML from bootstrap while preserving the fetched document', async () => {
    mockGlobals.apWrapper.loadCustomContentWithOrphanRecovery.mockResolvedValueOnce({
      customContent: {
        value: {
          diagramType: 'graph',
          graphXml: '<mxfile><diagram name="Diagram" /></mxfile>',
          boardGraphXml: '<mxfile><diagram name="Board">',
        },
      },
      probeResult: {},
    })

    await import('./forge-graph-viewer')

    await vi.waitFor(() => expect(h.bootstrapForgeViewer).toHaveBeenCalled())
    const [options] = h.bootstrapForgeViewer.mock.calls.at(-1) as any[]
    const result = await options.loadDiagram()

    expect(result).toMatchObject({
      loadError: {
        errorClass: 'malformed',
        errorCode: 'board_document_malformed',
      },
      doc: {
        graphXml: '<mxfile><diagram name="Diagram" /></mxfile>',
      },
    })
  })
})
