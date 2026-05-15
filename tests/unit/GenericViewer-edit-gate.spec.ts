/**
 * Regression test: viewer's Edit button must fire EventBus 'edit' directly,
 * without showing a paywall dialog. The paywall gate lives in the editor
 * (forgeIndex.ts → isPageEditorEditBlocked → PageEditorPaywallGate), not here.
 *
 * The bug (reproduced at zenuml.atlassian.net/wiki/spaces/ZEN/pages/1806270487/PVT+Lite):
 * Clicking "Continue editing without upgrading" in the viewer paywall dialog did nothing
 * because the viewer was double-gating — opening a paywall AND the editor would open
 * its own paywall, forcing the user to click "Continue" twice.
 */
import { mount } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import store from '@/model/store2'
import { DiagramType, DataSource } from '@/model/Diagram/Diagram'
import EventBus from '@/EventBus'

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: vi.fn(() => true),
      canUserEdit: vi.fn(() => Promise.resolve(true)),
      isDisplayMode: vi.fn(() => true),
      _getCurrentUser: vi.fn(() => Promise.resolve({ atlassianAccountId: 'u1' })),
      getCurrentSpace: vi.fn(() => Promise.resolve({ key: 'ZEN' })),
    },
  },
}))

vi.mock('@/services/MacroMetrics', () => ({
  default: { getMacroMetrics: vi.fn(() => Promise.resolve({ total: 120 })) },
}))

vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn(() => Promise.resolve({ CUSTOMER_SUCCESS_SERVICE: true })),
}))

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn(() => 'test.atlassian.net'),
}))

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: { PAYWALL_TRIGGERED: 'paywall_triggered', PAYWALL_BLOCKED_EDIT: 'paywall_blocked_edit' },
  UIComponent: { VIEWER_NOTICE: 'viewer_notice' },
}))

vi.mock('@/utils/window', () => ({ trackEvent: vi.fn(), getUrlParam: vi.fn() }))

vi.mock('@/services/DiagramLikes', () => ({
  toggleDiagramLike: vi.fn(() => Promise.resolve([])),
  getDiagramLikes: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/composables/useCustomerSuccessService', () => {
  return {
    useCustomerSuccessService: vi.fn(() => ({
      macrosCreated: 120,
      severity: 'critical',
      shouldBlockActions: true,   // paywall would block
      upgradeUrl: 'https://marketplace.atlassian.com',
      enterpriseBundleUrl: 'https://zenuml.com/enterprise',
      initialize: vi.fn(),
      spacePaid: false,
    })),
    MACROS_LIMIT: 100,
    getUpgradeContext: vi.fn(() => ({})),
  }
})

describe('GenericViewer — Edit button does not gate at viewer level', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.source = DataSource.CustomContent
    store.state.diagram.isCopy = false
  })

  it('fires EventBus edit immediately even when shouldBlockActions is true', async () => {
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const editSpy = vi.spyOn(EventBus, '$emit')
    const vm = wrapper.vm as any

    vm.edit()

    expect(editSpy).toHaveBeenCalledWith('edit')
    // viewer has no viewer-level paywall state at all — showUpgradeModal is gone
    expect(vm.showUpgradeModal).toBeUndefined()
  })

  it('viewer has no openUpgradeModal — paywall gating moved to editor (forgeIndex)', async () => {
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as any

    // The redesign intentionally removed the viewer-level paywall dialog.
    // openUpgradeModal / showUpgradeModal / onContinueEditing no longer exist here;
    // the gate lives in forgeIndex.ts → isPageEditorEditBlocked → PageEditorPaywallGate.
    expect(vm.openUpgradeModal).toBeUndefined()
    expect(vm.showUpgradeModal).toBeUndefined()
    expect(vm.onContinueEditing).toBeUndefined()
  })

  it('viewer edit() always fires EventBus without any paywall interception', async () => {
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const editSpy = vi.spyOn(EventBus, '$emit')
    const vm = wrapper.vm as any

    vm.edit()

    // Direct EventBus emission, no modal state changes
    expect(editSpy).toHaveBeenCalledWith('edit')
    expect(editSpy).toHaveBeenCalledTimes(1)
  })

  it('Edit button is shown but disabled with cross-page tooltip when isCopy=true copyReason=cross-page', async () => {
    store.state.diagram.isCopy = true
    ;(store.state.diagram as any).copyReason = 'cross-page'
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as any
    expect(vm.editDisabledReason).toContain('another page')

    const btn = wrapper.find('button[aria-label="Edit"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('another page')
  })

  it('Edit button is shown but disabled with duplicate tooltip when isCopy=true copyReason=same-page-duplicate', async () => {
    store.state.diagram.isCopy = true
    ;(store.state.diagram as any).copyReason = 'same-page-duplicate'
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as any
    expect(vm.editDisabledReason).toContain('multiple copies')

    const btn = wrapper.find('button[aria-label="Edit"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('multiple copies')
  })

  it('Edit button is shown and enabled when isCopy=false', async () => {
    store.state.diagram.isCopy = false
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as any
    expect(vm.editDisabledReason).toBeNull()

    const btn = wrapper.find('button[aria-label="Edit"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
  })
})
