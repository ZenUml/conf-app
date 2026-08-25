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

vi.mock('@/utils/viewerBootstrap', () => ({
  bootstrapForgeViewer: h.bootstrapForgeViewer,
}))
vi.mock('@/utils/drawio/loadDrawioViewer', () => ({
  ensureDrawioViewerLoaded: h.ensureDrawioViewerLoaded,
}))
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
})
