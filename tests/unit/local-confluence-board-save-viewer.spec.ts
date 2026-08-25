import { mount, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/DrawIoExtension/DrawIoExtension.vue', () => ({
  default: { name: 'DrawIoExtension', template: '<div data-testid="title-overlay" />' },
}))

vi.mock('@/utils/draftStore', () => ({
  makeDebouncedDraftSaver: () => ({ save: vi.fn(), flush: vi.fn(), cancel: vi.fn() }),
  loadDraft: vi.fn(async () => null),
  clearDraft: vi.fn(async () => undefined),
  primeCloudId: vi.fn(async () => undefined),
  getCachedCloudId: vi.fn(() => 'local-cloud'),
  getCachedSavedVersionUpdatedAt: vi.fn(() => undefined),
  saveDraftSync: vi.fn(),
  isDraftNewerThanSaved: vi.fn(() => false),
}))

vi.mock('@/utils/closeGuard', () => ({ setupCloseGuard: vi.fn(() => vi.fn()) }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: vi.fn() }))
vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div class="generic-viewer"><slot /></div>' },
}))

import ForgeGraphEditor from '@/components/DrawIoExtension/ForgeGraphEditor.vue'
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue'
import store from '@/model/store2'
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram'

const DIAGRAM_XML = '<mxfile><diagram name="Diagram"><mxGraphModel><root /></mxGraphModel></diagram></mxfile>'
const BOARD_XML = `<mxfile><diagram name="Board"><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="board-shape" value="Saved board checkpoint" vertex="1" parent="1"/>
</root></mxGraphModel></diagram></mxfile>`

describe('local Confluence Board host save → viewer', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: DIAGRAM_XML,
    }
    ;(window as any).ensureTitle = vi.fn(async () => 'Local Board')
    ;(window as any).mxUtils = {
      parseXml: vi.fn((xml: string) => new DOMParser().parseFromString(xml, 'text/xml')),
    }
    ;(window as any).GraphViewer = vi.fn((_container: HTMLElement, xmlNode: Element) => ({
      diagrams: [{}],
      currentPage: 0,
      xmlNode,
    }))
  })

  it('persists the real Board save payload and renders the Board document locally', async () => {
    let savedDocument: { graphXml: string; boardGraphXml?: string } | undefined
    const saveGraphAndExit = vi.fn(async (payload: { graphXml: string; boardGraphXml?: string }) => {
      savedDocument = payload
      return true
    })

    mount(ForgeGraphEditor, {
      props: {
        graphXml: DIAGRAM_XML,
        boardGraphXml: '',
        graphEditorMode: 'board',
        doc: {},
        customContentId: 'local-board-1',
        saveGraphAndExit,
      },
    })

    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'save', xml: BOARD_XML }),
    }))

    await vi.waitFor(() => expect(saveGraphAndExit).toHaveBeenCalledWith({
      graphXml: DIAGRAM_XML,
      boardGraphXml: BOARD_XML,
    }))

    store.state.diagram = {
      ...store.state.diagram,
      ...savedDocument,
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'board' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect((window as any).GraphViewer).toHaveBeenCalled())
    expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(BOARD_XML)
    const [, renderedXml] = (window as any).GraphViewer.mock.calls.at(-1)
    expect(renderedXml.outerHTML).toContain('Saved board checkpoint')
  })

  it('keeps rendering Diagram content outside Board mode', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: BOARD_XML,
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'diagram' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(DIAGRAM_XML))
  })

  it('falls back to Diagram content when a legacy Board macro has no Board document', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: '',
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'board' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(DIAGRAM_XML))
  })
})
