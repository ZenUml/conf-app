import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { DiagramType } from '@/model/Diagram/Diagram'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { isAgentLinkEnabled } from '@/apis/aiTitleFeatureFlag'
import { TIP_EDIT_MS, TIP_MIN_EDITS, TIP_TYPED_CHARS, useEditorMcpPromo } from './useEditorMcpPromo'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isAgentLinkEnabled: vi.fn(() => Promise.resolve(true)) }))
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {},
  getContext: vi.fn(() => Promise.resolve({ cloudId: 'cloud-1', accountId: 'acct-1' })),
}))

function setup(initial: { type?: string; code?: string; id?: string } = {}) {
  const diagramType = ref<string | undefined>(initial.type ?? DiagramType.Sequence)
  const code = ref(initial.code ?? 'A->B: hi')
  const diagramId = ref<string | undefined>(initial.id)
  let clock = 0
  let api!: ReturnType<typeof useEditorMcpPromo>
  const Host = defineComponent({
    setup() {
      api = useEditorMcpPromo({ diagramType, code, diagramId, now: () => clock })
      return () => h('div')
    },
  })
  mount(Host)
  return { api, code, diagramId, advance: (ms: number) => { clock += ms } }
}

const events = (name: string) => vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name)

describe('useEditorMcpPromo', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.mocked(isAgentLinkEnabled).mockResolvedValue(true)
    ;(window as any).forgeGlobal = { forgeContext: { extension: { content: { id: '42' } } } }
  })

  it('shows the new-diagram card while the starter code is untouched, then hides it on edit', async () => {
    const { api, code } = setup()
    await flushPromises()
    expect(api.showNewDiagramCard.value).toBe(true)
    expect(events('agent_link_mcp_button_shown')).toEqual([[
      'agent_link_mcp_button_shown',
      expect.objectContaining({ surface: 'editor', mcp_button_placement: 'editor_new_diagram', macro_type: DiagramType.Sequence }),
    ]])
    code.value += 'x'
    await nextTick()
    expect(api.showNewDiagramCard.value).toBe(false)
  })

  it('does not show the new-diagram card for a saved diagram', async () => {
    const { api } = setup({ id: '777' })
    await flushPromises()
    expect(api.showNewDiagramCard.value).toBe(false)
  })

  it(`shows the tip after ${TIP_TYPED_CHARS} hand-typed characters, ignoring pastes`, async () => {
    const { api, code } = setup({ id: '777' })
    await flushPromises()
    code.value += 'x'.repeat(500) // one paste-sized change: ignored
    await nextTick()
    expect(api.showTip.value).toBe(false)
    for (let typed = 0; typed < TIP_TYPED_CHARS; typed += 40) {
      code.value += 'y'.repeat(40)
      await nextTick()
    }
    expect(api.showTip.value).toBe(true)
    expect(events('agent_link_mcp_button_shown')).toContainEqual([
      'agent_link_mcp_button_shown',
      expect.objectContaining({ mcp_button_placement: 'editor_tip' }),
    ])
  })

  it(`shows the tip after ${TIP_MIN_EDITS} small edits spread over ${TIP_EDIT_MS / 60000} minutes`, async () => {
    const { api, code, advance } = setup({ id: '777' })
    await flushPromises()
    for (let i = 0; i < TIP_MIN_EDITS; i++) {
      code.value += 'z'
      advance(TIP_EDIT_MS / (TIP_MIN_EDITS - 1))
      await nextTick()
    }
    expect(api.showTip.value).toBe(true)
  })

  it('opens the dialog with a draft-and-paste prompt for a new diagram', async () => {
    const { api } = setup({ type: DiagramType.Mermaid })
    await flushPromises()
    api.onCta('editor_new_diagram')
    expect(api.dialogVisible.value).toBe(true)
    expect(api.showNewDiagramCard.value).toBe(false)
    expect(api.dialogPrompt.value).toContain('Mermaid')
    expect(api.dialogPrompt.value).toContain('pageId: 42')
    expect(api.dialogPrompt.value).toContain('Do not change Confluence yet')
    expect(events('agent_link_mcp_dialog_opened')).toEqual([[
      'agent_link_mcp_dialog_opened',
      expect.objectContaining({ surface: 'editor', mcp_button_placement: 'editor_new_diagram' }),
    ]])
  })

  it('fills cloudId and pageId into a target read before the context resolves', async () => {
    const { api } = setup({ id: '777' })
    // Read at first render, like the dialog's props, then let mount finish.
    expect(api.dialogTarget.value.cloudId).toBe('')
    await flushPromises()
    expect(api.dialogTarget.value).toEqual({ cloudId: 'cloud-1', pageId: '42', contentId: '777' })
  })

  it('fills the new-diagram prompt after the context resolves, even when read first', async () => {
    const { api } = setup()
    expect(api.dialogPrompt.value).not.toContain('cloudId:')
    await flushPromises()
    expect(api.dialogPrompt.value).toContain('cloudId: cloud-1')
    expect(api.dialogPrompt.value).toContain('pageId: 42')
  })

  it('uses the default review prompt for a saved diagram', async () => {
    const { api } = setup({ id: '777' })
    await flushPromises()
    expect(api.dialogPrompt.value).toBe('')
    expect(api.dialogTarget.value).toEqual({ cloudId: 'cloud-1', pageId: '42', contentId: '777' })
  })

  it('remembers a dismissal across editors', async () => {
    const first = setup()
    await flushPromises()
    first.api.onDismiss('editor_new_diagram')
    expect(first.api.showNewDiagramCard.value).toBe(false)
    expect(events('agent_link_mcp_promo_dismissed')).toEqual([[
      'agent_link_mcp_promo_dismissed',
      expect.objectContaining({ surface: 'editor', mcp_button_placement: 'editor_new_diagram' }),
    ]])
    const second = setup()
    await flushPromises()
    expect(second.api.showNewDiagramCard.value).toBe(false)
  })

  it('stops promoting after a successful copy from the dialog', async () => {
    const first = setup()
    await flushPromises()
    first.api.onCta('editor_new_diagram')
    first.api.onCopied('setup_command', true)
    first.api.closeDialog()
    expect(events('agent_link_mcp_dialog_closed')).toHaveLength(1)
    const second = setup()
    await flushPromises()
    expect(second.api.showNewDiagramCard.value).toBe(false)
  })

  it('stays hidden with the flag off or for an unsupported type', async () => {
    vi.mocked(isAgentLinkEnabled).mockResolvedValue(false)
    const off = setup()
    await flushPromises()
    expect(off.api.showNewDiagramCard.value).toBe(false)
    vi.mocked(isAgentLinkEnabled).mockResolvedValue(true)
    const graph = setup({ type: DiagramType.Graph })
    await flushPromises()
    expect(graph.api.showNewDiagramCard.value).toBe(false)
  })
})
