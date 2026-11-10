import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
vi.mock('@/components/DrawIoExtension/DrawIoExtension.vue', () => ({ default: { name: 'DrawIoExtension', template: '<div/>' } }))
vi.mock('@/model/globals/forgeGlobal', () => ({ getView: vi.fn(), getContext: vi.fn(), isInserting: vi.fn() }))
vi.mock('@/utils/closeGuard', () => ({ setupCloseGuard: vi.fn(() => vi.fn()) }))
vi.mock('@/utils/draftStore', () => ({
  makeDebouncedDraftSaver: vi.fn(() => ({ save: vi.fn(), flush: vi.fn(), cancel: vi.fn() })),
  loadDraft: vi.fn(async () => null),
  clearDraft: vi.fn(),
  primeCloudId: vi.fn(async () => 'cloud'),
  getCachedCloudId: vi.fn(() => 'cloud'),
  getCachedSavedVersionUpdatedAt: vi.fn(() => null),
  saveDraftSync: vi.fn(),
  isDraftNewerThanSaved: vi.fn(() => false),
}))
vi.mock('@/EventBus', () => ({ default: { $on: vi.fn(), $off: vi.fn(), $emit: vi.fn() } }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/composables/useAutoTitle', () => ({ notifyAiTitleSaved: vi.fn() }))

import { callRemote } from '@/utils/requestUtil'
import { setGraphEditorMode } from '@/utils/graph/graphEditorMode'
import ForgeGraphEditor from '@/components/DrawIoExtension/ForgeGraphEditor.vue'

const ICON = 'https://icons.diagrams.net/assets/azure/1/Azure_Service_Bus_Queues.svg'
const DATA = 'data:image/svg+xml;base64,PHN2Zy8+'
const model = (extra: string) => `<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${extra}</root></mxGraphModel></diagram></mxfile>`
const WITH_ICON = model(`<mxCell id="i" style="image=${ICON};" vertex="1" parent="1"/>`)
const PLAIN = model('<mxCell id="p" value="plain" vertex="1" parent="1"/>')

function mountEditor(graphXml: string) {
  const wrapper = mount(ForgeGraphEditor, {
    props: { graphXml, saveGraphAndExit: vi.fn(), doc: {}, customContentId: 'cc-1', graphEditorMode: 'diagram' },
    attachTo: document.body,
  })
  // Stand-in for the editor frame's own graph class.
  const win = (wrapper.find('iframe').element as HTMLIFrameElement).contentWindow as any
  class Graph {}
  Object.assign(Graph.prototype, { getImageFromBundles: () => null, getLabel: (c: any) => c.label })
  win.Graph = Graph
  return { wrapper, Graph }
}
const init = (w: ReturnType<typeof mountEditor>['wrapper']) => (w.vm as any).messageListener({ data: JSON.stringify({ event: 'init' }) })
const loads = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c[0] as any).filter((m) => m.action === 'load')

describe('ForgeGraphEditor external icons', () => {
  beforeEach(() => { vi.mocked(callRemote).mockReset(); setGraphEditorMode('diagram') })
  afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })

  it('loads at once, with no request, when the diagram has no external icons', () => {
    const { wrapper } = mountEditor(PLAIN)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    expect(loads(send)).toHaveLength(1)
    expect(callRemote).not.toHaveBeenCalled()
  })

  it('waits for the proxy, installs the resolver, then loads the ORIGINAL xml (saved xml keeps the icons.diagrams.net URL)', async () => {
    let answer!: (v: unknown) => void
    vi.mocked(callRemote).mockReturnValue(new Promise((r) => { answer = r }))
    const { wrapper, Graph } = mountEditor(WITH_ICON)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    await flushPromises()
    expect(loads(send)).toHaveLength(0)
    answer({ icons: { [ICON]: DATA }, failed: {} })
    await flushPromises()
    expect(loads(send)).toEqual([{ action: 'load', xml: WITH_ICON, autosave: 1 }])
    expect(loads(send)[0].xml).toContain(ICON)
    expect(loads(send)[0].xml).not.toContain('data:image')
    expect((new Graph() as any).getImageFromBundles(ICON)).toBe(DATA)
  })

  it('opens the editor anyway when the proxy fails', async () => {
    vi.mocked(callRemote).mockRejectedValue(Object.assign(new Error('HTTP 502'), { status: 502 }))
    const { wrapper } = mountEditor(WITH_ICON)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    await flushPromises()
    expect(loads(send)).toEqual([{ action: 'load', xml: WITH_ICON, autosave: 1 }])
  })

  it('opens the editor anyway when the proxy never answers', async () => {
    vi.useFakeTimers()
    vi.mocked(callRemote).mockReturnValue(new Promise(() => {}))
    const { wrapper } = mountEditor(WITH_ICON)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    await vi.advanceTimersByTimeAsync(2000)
    expect(loads(send)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2500)
    expect(loads(send)).toEqual([{ action: 'load', xml: WITH_ICON, autosave: 1 }])
  })

  it('a newer load wins over an older pending one (draft restore after init)', async () => {
    let answer!: (v: unknown) => void
    vi.mocked(callRemote).mockReturnValue(new Promise((r) => { answer = r }))
    const { wrapper } = mountEditor(WITH_ICON)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    ;(wrapper.vm as any).loadIntoFrame(PLAIN)
    await flushPromises()
    expect(loads(send)).toEqual([{ action: 'load', xml: PLAIN, autosave: 1 }])
    answer({ icons: { [ICON]: DATA }, failed: {} })
    await flushPromises()
    expect(loads(send)).toHaveLength(1)
  })

  it('does not refetch icons on a later load (mode switch back, restore)', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA }, failed: {} })
    const { wrapper } = mountEditor(WITH_ICON)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    await flushPromises()
    ;(wrapper.vm as any).onFrameLoad()
    expect(loads(send)).toHaveLength(2)
    expect(callRemote).toHaveBeenCalledTimes(1)
  })

  it('does not load into an unmounted editor', async () => {
    let answer!: (v: unknown) => void
    vi.mocked(callRemote).mockReturnValue(new Promise((r) => { answer = r }))
    const { wrapper } = mountEditor(WITH_ICON)
    const send = vi.spyOn(wrapper.vm as any, 'sendToFrame')
    init(wrapper)
    wrapper.unmount()
    answer({ icons: { [ICON]: DATA }, failed: {} })
    await flushPromises()
    expect(loads(send)).toHaveLength(0)
  })
})
