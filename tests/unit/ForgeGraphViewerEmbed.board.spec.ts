import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/drawio/loadDrawioViewer', () => ({
  ensureDrawioViewerLoaded: vi.fn(async () => undefined),
}))
vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div class="generic-viewer"><slot /></div>' },
}))

import ForgeGraphViewerEmbed from '@/components/Viewer/ForgeGraphViewerEmbed.vue'
import { DiagramType } from '@/model/Diagram/Diagram'

const DIAGRAM = '<mxfile><diagram name="Diagram"><mxGraphModel><root /></mxGraphModel></diagram></mxfile>'
const BOARD = '<mxfile><diagram name="Board"><mxGraphModel><root /></mxGraphModel></diagram></mxfile>'

/**
 * The embed host has NO macro config, so it cannot read graphEditorMode from a
 * Forge context. Before the body carried the mode, this component read
 * doc.graphXml unconditionally: an embedded Board macro rendered the stale
 * Diagram document, or reported "Missing graph data" when the macro had been
 * authored in Board mode from the start.
 */
describe('ForgeGraphViewerEmbed — Board awareness', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).mxUtils = {
      parseXml: vi.fn((xml: string) => new DOMParser().parseFromString(xml, 'text/xml')),
    }
    ;(window as any).GraphViewer = vi.fn(() => ({ diagrams: [{}], currentPage: 0 }))
  })

  const mountEmbed = (doc: Record<string, unknown>) =>
    mount(ForgeGraphViewerEmbed, { props: { doc } })

  it('renders the Board document for a Board-mode macro', async () => {
    mountEmbed({
      diagramType: DiagramType.Graph,
      graphXml: DIAGRAM,
      boardGraphXml: BOARD,
      graphEditorMode: 'board',
    })
    await flushPromises()

    expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(BOARD)
  })

  it('renders the Diagram document for a Diagram-mode macro that also holds Board content', async () => {
    mountEmbed({
      diagramType: DiagramType.Graph,
      graphXml: DIAGRAM,
      boardGraphXml: BOARD,
      graphEditorMode: 'diagram',
    })
    await flushPromises()

    expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(DIAGRAM)
  })

  it('renders the legacy body for a Board macro that predates boardGraphXml', async () => {
    mountEmbed({
      diagramType: DiagramType.Graph,
      graphXml: DIAGRAM,
      graphEditorMode: 'board',
    })
    await flushPromises()

    expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(DIAGRAM)
  })

  it('reads through the custom-content envelope', async () => {
    mountEmbed({
      value: {
        diagramType: DiagramType.Graph,
        graphXml: DIAGRAM,
        boardGraphXml: BOARD,
        graphEditorMode: 'board',
      },
    })
    await flushPromises()

    expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(BOARD)
  })
})
