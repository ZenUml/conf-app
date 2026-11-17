import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bootstrapForgeViewer: vi.fn(async (_options: { afterLoad: (doc: unknown) => void }) => undefined),
  ensureDrawioViewerLoaded: vi.fn(async () => undefined),
  whenDrawioMathSettled: vi.fn(async () => true),
  createAttachment: vi.fn(async () => undefined),
  trackEvent: vi.fn(),
}))

vi.mock('@/utils/viewerBootstrap', () => ({ bootstrapForgeViewer: h.bootstrapForgeViewer }))
vi.mock('@/utils/drawio/loadDrawioViewer', () => ({
  ensureDrawioViewerLoaded: h.ensureDrawioViewerLoaded,
  whenDrawioMathSettled: h.whenDrawioMathSettled,
}))
vi.mock('@/model/Attachment', () => ({ default: h.createAttachment }))
vi.mock('@/utils/window', () => ({ trackEvent: h.trackEvent, serializeError: String }))
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { isDisplayMode: () => true, canUserEdit: async () => true } },
}))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { isForge: true, isLite: false, isDiagramly: false, isAsyncApi: false },
  getContext: vi.fn(async () => ({ extension: { config: {} } })),
  openModal: vi.fn(),
}))
vi.mock('./EventBus', () => ({ default: { $on: vi.fn() } }))
vi.mock('@/utils/guardEditClick', () => ({ guardEditClick: vi.fn(async () => true) }))

const GRAPH_DOC = { graphXml: '<mxGraphModel math="1"><root/></mxGraphModel>' }

async function viewAfterCaptureDelay(): Promise<void> {
  await import('./forge-graph-viewer')
  await vi.waitFor(() => expect(h.bootstrapForgeViewer).toHaveBeenCalled())
  h.bootstrapForgeViewer.mock.calls[0][0].afterLoad(GRAPH_DOC)
  await vi.advanceTimersByTimeAsync(1500)
}

describe('Graph viewer backup PNG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for MathJax, because the canvas is hidden until it finishes and a blank PNG is never replaced', async () => {
    let settle!: (settled: boolean) => void
    h.whenDrawioMathSettled.mockReturnValueOnce(new Promise<boolean>((resolve) => { settle = resolve }))

    await viewAfterCaptureDelay()
    expect(h.createAttachment).not.toHaveBeenCalled()

    settle(true)
    await vi.waitFor(() => expect(h.createAttachment).toHaveBeenCalledWith(GRAPH_DOC.graphXml, 'graph'))
  })

  it('skips the PNG and reports it when MathJax never finishes, so a later view can retry', async () => {
    h.whenDrawioMathSettled.mockResolvedValueOnce(false)

    await viewAfterCaptureDelay()

    await vi.waitFor(() => expect(h.trackEvent).toHaveBeenCalledWith('graph_math_not_ready', 'create_attachment', 'warning'))
    expect(h.createAttachment).not.toHaveBeenCalled()
  })
})
