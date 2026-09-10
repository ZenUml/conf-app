import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExportModal from '@/components/ExportModal/ExportModal.vue'

const { toPng, exportDiagram } = vi.hoisted(() => ({
  toPng: vi.fn(async () => 'data:image/png;base64,cHJldmlldw=='),
  exportDiagram: vi.fn(async () => ({ ok: true })),
}))

vi.mock('html-to-image', () => ({ toPng }))
vi.mock('@/components/ExportModal/useExportEngine', async (original) => {
  const actual = await original<typeof import('@/components/ExportModal/useExportEngine')>()
  return {
    ...actual,
    useExportEngine: () => ({ exportDiagram, exportDiagramToClipboard: vi.fn() }),
  }
})
vi.mock('@/model/globals/forgeGlobal', async (original) => {
  const actual = await original<typeof import('@/model/globals/forgeGlobal')>()
  return {
    ...actual,
    getContext: vi.fn(async () => ({
      accountId: 'account-example',
      siteUrl: 'https://example-tenant.atlassian.net',
      moduleKey: 'zenuml-mermaid-macro-lite',
      localId: 'macro-example',
      contentId: 'content-example',
      extension: { type: 'confluence:macro', space: { name: 'Example space' } },
    })),
  }
})
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

function mountExport(captureTarget: HTMLElement) {
  return mount(ExportModal, {
    props: {
      visible: false,
      macroType: 'mermaid',
      diagramTitle: 'Example diagram',
      captureNodeGetter: () => captureTarget,
    },
    attachTo: document.body,
  })
}

describe('PNG Export feedback acceptance', () => {
  let warn: { mockRestore: () => void }
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    toPng.mockClear()
    exportDiagram.mockClear()
  })

  afterEach(() => { warn.mockRestore(); document.body.innerHTML = '' })

  it('reveals the flush-right Feedback trigger only on edge hover or keyboard focus', async () => {
    const wrapper = mountExport(document.createElement('div'))
    await wrapper.setProps({ visible: true })
    await flushPromises()

    const edge = wrapper.get('[data-testid="feedback-edge"]')
    expect(edge.classes()).not.toContain('revealed')
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('focusin')
    expect(edge.classes()).toContain('revealed')
  })

  it('opens the shared feedback flow with surface set to png_export', async () => {
    const wrapper = mountExport(document.createElement('div'))
    await wrapper.setProps({ visible: true })
    await flushPromises()
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')

    expect(wrapper.get('[role="dialog"][aria-labelledby="feedback-title"]').exists()).toBe(true)
    expect(wrapper.get('details').text()).toContain('8 fields attached automatically')
  })

  it('places feedback UI outside the export capture subtree', async () => {
    const wrapper = mountExport(document.createElement('div'))
    await wrapper.setProps({ visible: true })
    await flushPromises()
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')

    const exportTree = wrapper.get('.export-modal').element
    expect(exportTree.contains(wrapper.get('[data-testid="feedback-edge"]').element)).toBe(false)
    expect(exportTree.contains(wrapper.get('.feedback-overlay').element)).toBe(false)
  })

  it('uses only the diagram capture node for preview and downloaded PNG bytes', async () => {
    const target = document.createElement('div')
    target.className = 'screen-capture-content'
    target.textContent = 'diagram only'
    document.body.appendChild(target)
    const wrapper = mountExport(target)
    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(toPng).toHaveBeenCalledWith(target, expect.any(Object))
    await (wrapper.vm as any).handleExport()
    expect(exportDiagram).toHaveBeenCalledWith(expect.any(Object), 'Example diagram', target)
    expect(target.querySelector('[data-testid="feedback-edge"]')).toBeNull()
    expect(target.querySelector('.feedback-overlay')).toBeNull()
  })
})
