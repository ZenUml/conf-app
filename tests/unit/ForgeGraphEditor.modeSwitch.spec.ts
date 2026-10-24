import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import EventBus from '@/EventBus'
import { clearDraft, isDraftNewerThanSaved, loadDraft, makeDebouncedDraftSaver } from '@/utils/draftStore'
import {
  getGraphEditorMode,
  setGraphEditorMode,
  mxfileContentFingerprint,
} from '@/utils/graph/graphEditorMode'

vi.mock('@/components/DrawIoExtension/DrawIoExtension.vue', () => ({
  default: { name: 'DrawIoExtension', template: '<div class="drawio-title-overlay"><span>TITLE</span><input placeholder="Name your graph…" /></div>' },
}))
vi.mock('@/model/globals/forgeGlobal', () => ({
  getView: vi.fn(),
  getContext: vi.fn(),
  isInserting: vi.fn(),
}))
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
vi.mock('@/EventBus', () => ({
  default: { $on: vi.fn(), $off: vi.fn(), $emit: vi.fn() },
}))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/composables/useAutoTitle', () => ({ notifyAiTitleSaved: vi.fn() }))

import ForgeGraphEditor from '@/components/DrawIoExtension/ForgeGraphEditor.vue'

const PAGE = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="lamp" value="Lamp doesn't work" vertex="1" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

const EDITED = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="lamp" value="Lamp doesn't work" vertex="1" />
        <mxCell id="fix" value="Fix lamp" vertex="1" />
      </root>
    </mxGraphModel>
  </diagram>
  <diagram name="Page-2">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

const BOARD = `<mxfile>
  <diagram name="Board-1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="board-card" value="Board card" vertex="1" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(ForgeGraphEditor, {
    props: {
      graphXml: PAGE,
      saveGraphAndExit: vi.fn(),
      doc: { title: 'Check if Lamp is Working' },
      customContentId: 'cc-1',
      graphEditorMode: 'diagram',
      ...props,
    },
    attachTo: document.body,
  })
}

function iframeSrc(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('iframe').attributes('src') || ''
}

function fireInit(wrapper: ReturnType<typeof mount>) {
  wrapper.vm.messageListener({ data: JSON.stringify({ event: 'init' }) })
}

describe('ForgeGraphEditor Diagram/Board mode switch', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.mocked(EventBus.$emit).mockClear()
    vi.mocked(makeDebouncedDraftSaver).mockClear()
    vi.mocked(loadDraft).mockReset()
    vi.mocked(loadDraft).mockResolvedValue(null)
    vi.mocked(isDraftNewerThanSaved).mockReset()
    vi.mocked(isDraftNewerThanSaved).mockReturnValue(false)
    setGraphEditorMode('diagram')
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('initializes Diagram chrome for a new document', () => {
    const wrapper = mountEditor({ graphEditorMode: undefined, customContentId: undefined })
    expect(iframeSrc(wrapper)).not.toContain('sketch=1')
    expect(iframeSrc(wrapper)).not.toContain('ui=sketch')
    expect(getGraphEditorMode()).toBe('diagram')
    wrapper.unmount()
  })

  it('initializes Board chrome from persisted config', () => {
    const wrapper = mountEditor({ graphEditorMode: 'board' })
    expect(iframeSrc(wrapper)).toContain('sketch=1')
    expect(iframeSrc(wrapper)).toContain('ui=sketch')
    expect(getGraphEditorMode()).toBe('board')
    wrapper.unmount()
  })

  // Switching INTO Board from a Diagram macro starts an independent, empty
  // document — the Diagram body belongs to the other surface.
  it('opens an empty Board when switching into Board from a Diagram macro', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'diagram', graphXml: PAGE })
    await flushPromises()
    wrapper.vm.switchGraphEditorMode('board')
    await flushPromises()
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')

    fireInit(wrapper)
    wrapper.vm.onFrameLoad()
    await flushPromises()

    const loaded = send.mock.calls.find((call) => call[0]?.action === 'load')?.[0]?.xml
    expect(loaded).toBeTruthy()
    expect(loaded).not.toContain('Lamp doesn\'t work')
    expect(loaded).not.toContain('id="lamp"')
    wrapper.unmount()
  })

  // A macro published in Board mode by v2026.08.250259-diagramly (the
  // published Diagramly release that shipped Board mode) stored its body in
  // graphXml, because boardGraphXml did not exist yet. Opening those on an
  // empty canvas hid the customer's content. `boardGraphXml === undefined` is
  // that legacy shape; an empty string is a real, empty Board document.
  it('loads the legacy Diagram body when a Board macro has no boardGraphXml field', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board', graphXml: PAGE })
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')

    fireInit(wrapper)
    wrapper.vm.onFrameLoad()
    await flushPromises()

    const loaded = send.mock.calls.find((call) => call[0]?.action === 'load')?.[0]?.xml
    expect(loaded).toBe(PAGE)
    wrapper.unmount()
  })

  it('keeps an existing empty Board document empty rather than borrowing Diagram XML', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board', graphXml: PAGE, boardGraphXml: '' })
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')

    fireInit(wrapper)
    wrapper.vm.onFrameLoad()
    await flushPromises()

    const loaded = send.mock.calls.find((call) => call[0]?.action === 'load')?.[0]?.xml
    expect(loaded).toBeTruthy()
    expect(loaded).not.toContain('id="lamp"')
    wrapper.unmount()
  })

  it('loads persisted Board content when the saved editor mode is Board', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board', boardGraphXml: BOARD })
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')

    fireInit(wrapper)
    await flushPromises()

    const loaded = send.mock.calls.find((call) => call[0]?.action === 'load')?.[0]?.xml
    expect(loaded).toBe(BOARD)
    wrapper.unmount()
  })

  it('falls back to Diagram for an unknown persisted mode', () => {
    const wrapper = mountEditor({ graphEditorMode: 'whiteboard' })
    expect(iframeSrc(wrapper)).not.toContain('sketch=1')
    wrapper.unmount()
  })

  it('does not reload or emit success when the current mode is clicked', async () => {
    const wrapper = mountEditor()
    const src = iframeSrc(wrapper)
    await wrapper.vm.switchGraphEditorMode('diagram')
    expect(iframeSrc(wrapper)).toBe(src)
    expect(trackAnalyticsEvent).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loads the saved Board mxfile instead of carrying Diagram edits across modes', async () => {
    const wrapper = mountEditor({ boardGraphXml: BOARD })
    wrapper.vm.diagramXml = EDITED
    wrapper.vm.drawioModified = true
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')
    await wrapper.vm.switchGraphEditorMode('board')
    expect(iframeSrc(wrapper)).toContain('sketch=1')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'graph_editor_mode_switch_requested',
      expect.objectContaining({
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'graph',
        from_mode: 'diagram',
        to_mode: 'board',
        has_unsaved_changes: true,
      }),
    )
    fireInit(wrapper)
    await flushPromises()
    expect(send).toHaveBeenCalledWith({ action: 'load', xml: BOARD, autosave: 1 })
    const loaded = send.mock.calls.find((c) => c[0]?.action === 'load')?.[0]?.xml
    expect(mxfileContentFingerprint(loaded)).toEqual(mxfileContentFingerprint(BOARD))
    wrapper.unmount()
  })

  it('restores the saved Diagram mxfile after switching back from Board', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board', boardGraphXml: EDITED })
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')
    await wrapper.vm.switchGraphEditorMode('diagram')
    expect(iframeSrc(wrapper)).not.toContain('sketch=1')
    fireInit(wrapper)
    await flushPromises()
    const loaded = send.mock.calls.find((c) => c[0]?.action === 'load')?.[0]?.xml
    expect(loaded).toBe(PAGE)
    wrapper.unmount()
  })

  it('restores the saved Diagram content after editing an independent Board document', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board', graphXml: PAGE })
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')

    fireInit(wrapper)
    await flushPromises()
    wrapper.vm.messageListener({
      data: JSON.stringify({ event: 'autosave', xml: BOARD, modified: true }),
    })

    await wrapper.vm.switchGraphEditorMode('diagram')
    fireInit(wrapper)
    await flushPromises()

    const loads = send.mock.calls
      .filter((call) => call[0]?.action === 'load')
      .map((call) => call[0]?.xml)
    expect(loads.at(-1)).toBe(PAGE)
    wrapper.unmount()
  })

  it('does not offer a Diagram draft while opening the Board editor', async () => {
    vi.mocked(loadDraft).mockResolvedValueOnce({
      code: BOARD,
      title: '',
      savedAt: Date.now() + 1_000,
      graphEditorMode: 'diagram',
    })
    vi.mocked(isDraftNewerThanSaved).mockReturnValue(true)

    const wrapper = mountEditor({ graphEditorMode: 'board', graphXml: PAGE })
    await flushPromises()

    expect(EventBus.$emit).not.toHaveBeenCalledWith(
      'draft-available',
      expect.objectContaining({ draft: expect.objectContaining({ graphEditorMode: 'diagram' }) }),
    )
    wrapper.unmount()
  })

  it('uses a mode-scoped draft key when switching between editors', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board' })
    await flushPromises()

    expect(makeDebouncedDraftSaver).toHaveBeenCalledWith('new:graph:board', 500)
    await wrapper.vm.switchGraphEditorMode('diagram')
    expect(makeDebouncedDraftSaver).toHaveBeenCalledWith('new:graph:diagram', 500)
    wrapper.unmount()
  })

  // Pre-Board releases keyed graph drafts as `edit:<id>` / `new:graph`. This
  // branch adds a `:<mode>` suffix, so a draft written by the deployed build
  // would otherwise be unreachable and never cleared.
  it('offers a draft written under the pre-Board unsuffixed key, then clears it', async () => {
    vi.mocked(loadDraft).mockImplementation(async (scope: string) => (
      scope === 'new:graph'
        ? { code: EDITED, title: '', savedAt: Date.now() + 1_000 }
        : null
    ) as any)
    vi.mocked(isDraftNewerThanSaved).mockReturnValue(true)

    const wrapper = mountEditor({ graphEditorMode: 'diagram', graphXml: PAGE })
    await flushPromises()

    expect(EventBus.$emit).toHaveBeenCalledWith(
      'draft-available',
      expect.objectContaining({
        scope: 'new:graph:diagram',
        draft: expect.objectContaining({ code: EDITED }),
      }),
    )
    expect(clearDraft).toHaveBeenCalledWith('new:graph')
    wrapper.unmount()
  })

  // The switch installed a saver for the target scope but never READ it, while
  // the next publish deleted both scopes — a draft in the non-initial mode was
  // silently discarded.
  it('offers the target mode\'s draft when switching into it', async () => {
    vi.mocked(loadDraft).mockImplementation(async (scope: string) => (
      scope === 'new:graph:board'
        ? { code: BOARD, title: '', savedAt: Date.now() + 1_000, graphEditorMode: 'board' }
        : null
    ) as any)
    vi.mocked(isDraftNewerThanSaved).mockReturnValue(true)

    const wrapper = mountEditor({ graphEditorMode: 'diagram', graphXml: PAGE })
    await flushPromises()
    vi.mocked(EventBus.$emit).mockClear()

    await wrapper.vm.switchGraphEditorMode('board')
    await flushPromises()

    expect(EventBus.$emit).toHaveBeenCalledWith(
      'draft-available',
      expect.objectContaining({ scope: 'new:graph:board' }),
    )
    wrapper.unmount()
  })

  // draftScopeBase() reads diagram.id, which the save itself populates on a
  // brand-new macro. Recomputing the scope inside the 'saved' handler cleared
  // `edit:<newId>:*` and orphaned the `new:graph:*` drafts the session wrote.
  it('clears the draft scopes captured at mount, not ones recomputed after the save', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'diagram' })
    await flushPromises()
    vi.mocked(clearDraft).mockClear()

    // The save assigns a real content id before the 'saved' handler runs.
    wrapper.vm.$store = { state: { diagram: { id: 'cc-new-42' } } }
    wrapper.vm.savedListener()

    expect(clearDraft).toHaveBeenCalledWith('new:graph:diagram')
    expect(clearDraft).toHaveBeenCalledWith('new:graph:board')
    expect(clearDraft).not.toHaveBeenCalledWith('edit:cc-new-42:diagram')
    wrapper.unmount()
  })

  it('publishes Board content without replacing the legacy Diagram content', async () => {
    const saveGraphAndExit = vi.fn().mockResolvedValue(true)
    const ensureTitle = vi.fn().mockResolvedValue('Board')
    const previousEnsureTitle = (window as any).ensureTitle
    ;(window as any).ensureTitle = ensureTitle
    const wrapper = mountEditor({ graphEditorMode: 'board', graphXml: PAGE, saveGraphAndExit })

    wrapper.vm.messageListener({
      data: JSON.stringify({ event: 'save', xml: BOARD }),
    })
    await flushPromises()

    expect(saveGraphAndExit).toHaveBeenCalledWith({ graphXml: PAGE, boardGraphXml: BOARD })
    ;(window as any).ensureTitle = previousEnsureTitle
    wrapper.unmount()
  })

  it('allows an empty source to switch into an empty Board document', async () => {
    const wrapper = mountEditor({ graphXml: '' })
    await wrapper.vm.switchGraphEditorMode('board')
    expect(iframeSrc(wrapper)).toContain('sketch=1')
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('graph_editor_mode_switch_failed', expect.anything())
    wrapper.unmount()
  })

  it('emits succeeded with content_preserved after a successful reload', async () => {
    const wrapper = mountEditor()
    wrapper.vm.diagramXml = EDITED
    wrapper.vm.drawioModified = true
    await wrapper.vm.switchGraphEditorMode('board')
    fireInit(wrapper)
    await flushPromises()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'graph_editor_mode_switch_succeeded',
      expect.objectContaining({
        from_mode: 'diagram',
        to_mode: 'board',
        content_preserved: true,
      }),
    )
    const payload = vi.mocked(trackAnalyticsEvent).mock.calls.find((c) => c[0] === 'graph_editor_mode_switch_succeeded')?.[1]
    expect(typeof payload?.reload_duration_ms).toBe('number')
    wrapper.unmount()
  })

  it('keeps the TITLE overlay as the naming control after a mode switch', async () => {
    const wrapper = mountEditor()
    await wrapper.vm.switchGraphEditorMode('board')
    expect(wrapper.find('.drawio-title-overlay').exists()).toBe(true)
    expect(wrapper.find('.drawio-title-overlay').text()).toContain('TITLE')
    wrapper.unmount()
  })

  it('hides DrawIO filename chrome when Board menubar mounts', () => {
    const wrapper = mountEditor({ graphEditorMode: 'board' })
    const doc = document.implementation.createHTMLDocument('drawio')
    const menubar = doc.createElement('div')
    menubar.className = 'geMenubarContainer'
    menubar.style.height = '44px'
    menubar.style.width = '1200px'
    Object.defineProperty(menubar, 'getBoundingClientRect', {
      value: () => ({ width: 1200, height: 44, top: 0, left: 0, right: 1200, bottom: 44, x: 0, y: 0, toJSON() { return {} } }),
    })
    const fname = doc.createElement('div')
    fname.className = 'geFilename'
    fname.textContent = 'Untitled Diagram'
    menubar.appendChild(fname)
    doc.body.appendChild(menubar)
    wrapper.vm.mountModeSwitch(doc)
    expect(fname.style.display).toBe('none')
    expect(doc.querySelector('.graph-mode-switch')).toBeTruthy()
    expect(doc.querySelector('.graph-mode-switch')?.textContent).toContain('Diagram')
    expect(doc.querySelector('.graph-mode-switch')?.textContent).toContain('Board')
    wrapper.unmount()
  })
})
