import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
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

  it('captures current mxfile before reloading into Board', async () => {
    const wrapper = mountEditor()
    wrapper.vm.latestXml = EDITED
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
    expect(send).toHaveBeenCalledWith({ action: 'load', xml: EDITED, autosave: 1 })
    const loaded = send.mock.calls.find((c) => c[0]?.action === 'load')?.[0]?.xml
    expect(mxfileContentFingerprint(loaded)).toEqual(mxfileContentFingerprint(EDITED))
    wrapper.unmount()
  })

  it('restores the same mxfile after switching back to Diagram', async () => {
    const wrapper = mountEditor({ graphEditorMode: 'board' })
    wrapper.vm.latestXml = EDITED
    const send = vi.spyOn(wrapper.vm, 'sendToFrame')
    await wrapper.vm.switchGraphEditorMode('diagram')
    expect(iframeSrc(wrapper)).not.toContain('sketch=1')
    fireInit(wrapper)
    await flushPromises()
    const loaded = send.mock.calls.find((c) => c[0]?.action === 'load')?.[0]?.xml
    expect(loaded).toBe(EDITED)
    wrapper.unmount()
  })

  it('emits succeeded only after reload restore, never after a failure', async () => {
    const wrapper = mountEditor({ graphXml: '' })
    wrapper.vm.latestXml = null
    await wrapper.vm.switchGraphEditorMode('board')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'graph_editor_mode_switch_failed',
      expect.objectContaining({
        from_mode: 'diagram',
        to_mode: 'board',
        failure_stage: 'capture',
      }),
    )
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'graph_editor_mode_switch_succeeded',
      expect.anything(),
    )
    wrapper.unmount()
  })

  it('emits succeeded with content_preserved after a successful reload', async () => {
    const wrapper = mountEditor()
    wrapper.vm.latestXml = EDITED
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
