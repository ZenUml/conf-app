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
  ProductOption: { MARKETPLACE: 'marketplace', ENTERPRISE_BUNDLE: 'enterprise_bundle' },
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
    expect(vm.showUpgradeModal).toBe(false)  // no viewer-level paywall dialog
  })

  it('Upgrade badge opens the upgrade modal without firing edit', async () => {
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const editSpy = vi.spyOn(EventBus, '$emit')
    const vm = wrapper.vm as any

    vm.openUpgradeModal()

    expect(vm.showUpgradeModal).toBe(true)
    expect(editSpy).not.toHaveBeenCalledWith('edit')
  })

  it('Continue editing from Upgrade badge just closes the modal', async () => {
    const wrapper = mount(GenericViewer, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()

    const editSpy = vi.spyOn(EventBus, '$emit')
    const vm = wrapper.vm as any

    vm.openUpgradeModal()
    expect(vm.showUpgradeModal).toBe(true)

    vm.onContinueEditing()

    expect(vm.showUpgradeModal).toBe(false)
    expect(editSpy).not.toHaveBeenCalledWith('edit')  // no edit from upgrade badge
  })
})
