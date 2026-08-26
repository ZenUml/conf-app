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
    store.state.diagramLoadComplete = true
    store.state.viewerLoadState = null
    store.state.loadError = null
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

  it('keeps rendering legacy Diagram content when the macro is in Diagram mode and has no Board document', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: undefined,
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'diagram' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect((window as any).mxUtils.parseXml).toHaveBeenCalledWith(DIAGRAM_XML))
    expect(store.state.viewerLoadState).toBeNull()
  })

  it('fails fast when a Board macro has no Board document instead of rendering legacy Diagram content', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: undefined,
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'board' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect(store.state.viewerLoadState).toBe('failed_without_source'))
    expect((window as any).mxUtils.parseXml).not.toHaveBeenCalled()
    expect((window as any).GraphViewer).not.toHaveBeenCalled()
    expect(store.state.diagram.graphXml).toBe(DIAGRAM_XML)
  })

  it('fails fast when a Board document is only whitespace and preserves Diagram content', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: ' \n\t ',
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'board' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect(store.state.viewerLoadState).toBe('failed_without_source'))
    expect(store.state.loadError).toEqual({
      errorClass: 'malformed',
      errorCode: 'board_document_empty',
    })
    expect((window as any).mxUtils.parseXml).not.toHaveBeenCalled()
    expect(store.state.diagram.graphXml).toBe(DIAGRAM_XML)
  })

  it('fails fast when a Board document is malformed instead of rendering Diagram content', async () => {
    const malformedBoard = '<mxfile><diagram name="Board"><mxGraphModel>'
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: malformedBoard,
    }
    ;(window as any).mxUtils.parseXml = vi.fn(() => {
      throw new Error('malformed board xml')
    })

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'board' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect(store.state.viewerLoadState).toBe('failed_without_source'))
    expect(store.state.loadError).toEqual({
      errorClass: 'malformed',
      errorCode: 'board_document_malformed',
    })
    expect((window as any).GraphViewer).not.toHaveBeenCalled()
    expect(store.state.diagram.graphXml).toBe(DIAGRAM_XML)
    expect(store.state.diagram.boardGraphXml).toBe(malformedBoard)
  })

  it('treats a non-string Board document as malformed instead of coercing it', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      graphXml: DIAGRAM_XML,
      boardGraphXml: null as any,
    }

    mount(ForgeGraphViewer, {
      props: { graphEditorMode: 'board' },
      global: { plugins: [store] },
    })

    await vi.waitFor(() => expect(store.state.viewerLoadState).toBe('failed_without_source'))
    expect(store.state.loadError).toEqual({
      errorClass: 'malformed',
      errorCode: 'board_document_malformed',
    })
    expect((window as any).mxUtils.parseXml).not.toHaveBeenCalled()
    expect(store.state.diagram.graphXml).toBe(DIAGRAM_XML)
  })
})
