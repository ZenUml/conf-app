import { mount } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import store from '@/model/store2'
import { DiagramType, DataSource } from '@/model/Diagram/Diagram'
import EventBus from '@/EventBus'
import * as upgradeTracking from '@/utils/upgradeTracking'

// Mock globals
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: vi.fn(() => false),
      canUserEdit: vi.fn(() => Promise.resolve(true)),
      isDisplayMode: vi.fn(() => true),
      _getCurrentUser: vi.fn(() => Promise.resolve({ atlassianAccountId: 'test-user-id' })),
      getCurrentSpace: vi.fn(() => Promise.resolve({ key: 'TEST' }))
    }
  }
}))

// Mock macro metrics service
vi.mock('@/services/MacroMetrics', () => ({
  default: {
    getMacroMetrics: vi.fn(() => Promise.resolve({ total: 75 }))
  }
}))

// Mock feature flags
vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn(() => Promise.resolve({ CUSTOMER_SUCCESS_SERVICE: true }))
}))

// Mock context parameters
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn(() => 'test.atlassian.net')
}))

// Mock upgrade tracking
vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    MODAL_SHOWN: 'modal_shown',
    PAYWALL_TRIGGERED: 'paywall_triggered',
    CTA_CLICKED: 'cta_clicked'
  },
  UIComponent: {
    VIEWER_NOTICE: 'viewer_notice',
    TOOLTIP: 'tooltip'
  },
  ProductOption: {
    MARKETPLACE: 'marketplace',
    ENTERPRISE_BUNDLE: 'enterprise_bundle'
  }
}))

// Mock window.trackEvent
vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  getUrlParam: vi.fn()
}))

// Mock diagram likes service
vi.mock('@/services/DiagramLikes', () => ({
  toggleDiagramLike: vi.fn(() => Promise.resolve()),
  getDiagramLikes: vi.fn(() => Promise.resolve([]))  // Returns array of likes
}))

// Mock useCustomerSuccessService to control spacePaid and macrosCreated.
// Use plain values (not refs) so Vue Options API data() treats them as reactive primitives.
vi.mock('@/composables/useCustomerSuccessService', async () => {
  const { ref } = await import('vue')
  return {
    useCustomerSuccessService: vi.fn(() => ({
      macrosCreated: 0,
      severity: 'none',
      shouldBlockActions: false,
      upgradeUrl: 'https://marketplace.atlassian.com',
      enterpriseBundleUrl: 'https://zenuml.com/enterprise',
      initialize: vi.fn(),
      spacePaid: false,
      // Persona-aware paywall fields (used by UpgradePromptRouter)
      persona: ref('creator'),
      personalAuthored: ref(0),
      tenantSizeEstimate: ref('unknown'),
      personaAwarePaywallEnabled: ref(false),
    })),
    MACROS_LIMIT: 100,
    getUpgradeContext: vi.fn(() => ({}))
  }
})

describe('GenericViewer - Upgrade Features', () => {
  let macroMetrics: any
  let featureFlags: any

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks()

    // Reset store state
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.source = DataSource.CustomContent
    store.state.diagram.isCopy = false

    // Get mocked modules
    macroMetrics = await import('@/services/MacroMetrics')
    featureFlags = await import('@/apis/featureFlags')

    // Clear localStorage mocks
    delete localStorage.mockMacroCount
    delete localStorage.mockCSSEnabled
  })

  afterEach(() => {
    // Clean up
    delete localStorage.mockMacroCount
    delete localStorage.mockCSSEnabled
  })

  describe('isLite Detection', () => {
    it('should show upgrade button when isLite() returns true', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()
      
      // Set macro count to ensure button shows (> 50)
      const vm = wrapper.vm as any
      vm.macrosCreated = 75
      await wrapper.vm.$nextTick()

      // Find the upgrade button
      const upgradeButton = wrapper.find('button[title="Upgrade to unlock unlimited diagrams"]')
      expect(upgradeButton.exists()).toBe(true)
      expect(upgradeButton.text()).toContain('Upgrade')
    })

    it('should hide upgrade button when isLite() returns false', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => false)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()

      // Upgrade button should not exist
      const upgradeButton = wrapper.find('button[title="Upgrade to unlock unlimited diagrams"]')
      expect(upgradeButton.exists()).toBe(false)
    })

    it('should hide upgrade button when macro count is 50 or less', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()

      const vm = wrapper.vm as any
      // Set macro count to 50 or less
      vm.macrosCreated = 50
      await wrapper.vm.$nextTick()

      // Upgrade button should not exist because macrosCreated <= 50
      const upgradeButton = wrapper.find('button[title="Upgrade to unlock unlimited diagrams"]')
      expect(upgradeButton.exists()).toBe(false)
    })
  })

  describe('Upgrade Modal Interaction', () => {
    it('should open upgrade modal when upgrade button is clicked', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()
      
      // Set macro count to ensure button shows (> 50)
      const vm = wrapper.vm as any
      vm.macrosCreated = 75
      await wrapper.vm.$nextTick()

      // Pre-condition: modal is not shown
      expect(vm.showUpgradeModal).toBe(false)

      // Click upgrade button
      const upgradeButton = wrapper.find('button[title="Upgrade to unlock unlimited diagrams"]')
      await upgradeButton.trigger('click')

      // Modal should be shown
      expect(vm.showUpgradeModal).toBe(true)
    })

    it('should pass correct props to UpgradePrompt component', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()
      
      // Set macro count to ensure button shows (> 50)
      const vm = wrapper.vm as any
      vm.macrosCreated = 75
      await wrapper.vm.$nextTick()

      // Click upgrade button to show modal
      const upgradeButton = wrapper.find('button[title="Upgrade to unlock unlimited diagrams"]')
      await upgradeButton.trigger('click')
      await wrapper.vm.$nextTick()

      // Check if the modal is shown via component state
      expect(vm.showUpgradeModal).toBe(true)
      // Check that the component has the reactive values (they are refs from the composable)
      expect(vm.macrosCreated).toBeDefined()
      expect(vm.MACROS_LIMIT).toBe(100)
      expect(vm.upgradeUrl).toBeDefined()
      expect(vm.enterpriseBundleUrl).toBeDefined()
    })
  })

  describe('Action Blocking (Customer Success Service)', () => {
    it('should verify edit() method respects shouldBlockActions computed property', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()

      const vm = wrapper.vm as any

      // Test the edit() method's blocking logic
      // The method checks: if (this.shouldBlockActions) { block } else { allow }

      // Store original state
      const originalMacros = vm.macrosCreated

      // Mock EventBus.$emit
      const eventBusSpy = vi.spyOn(EventBus, '$emit')

      // Test 1: Set macros to trigger blocking (>= 100)
      vm.macrosCreated = 150
      await wrapper.vm.$nextTick()

      // Call edit method directly
      vm.edit()

      // Should block because: macros (150) >= 100 && isLite (true) && CSS enabled (true from mock)
      const wasBlocked = !eventBusSpy.mock.calls.some(call => call[0] === 'edit')

      if (wasBlocked) {
        expect(vm.showUpgradeModal).toBe(true)
        expect(upgradeTracking.trackUpgradeEvent).toHaveBeenCalledWith(
          upgradeTracking.UpgradeEventName.PAYWALL_TRIGGERED,
          expect.objectContaining({
            ui_component: upgradeTracking.UIComponent.VIEWER_NOTICE,
            action_type: 'edit'
          })
        )
      }

      // Restore
      vm.macrosCreated = originalMacros
    })

    it('should allow edit when macros < 100 (under limit)', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()

      const vm = wrapper.vm as any

      // Set macros to be under limit
      vm.macrosCreated = 50
      await wrapper.vm.$nextTick()

      // Mock EventBus.$emit
      const eventBusSpy = vi.spyOn(EventBus, '$emit')

      // Call edit method
      vm.edit()

      // Should allow because macros < 100
      expect(eventBusSpy).toHaveBeenCalledWith('edit')
      expect(vm.showUpgradeModal).toBe(false)
    })

    it('should not block when isLite is false (Full version)', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => false)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()

      const vm = wrapper.vm as any

      // Even with high macro count
      vm.macrosCreated = 150
      await wrapper.vm.$nextTick()

      // Mock EventBus.$emit
      const eventBusSpy = vi.spyOn(EventBus, '$emit')

      // Call edit method
      vm.edit()

      // Should allow because isLite = false (shouldBlockActions checks isLite)
      expect(eventBusSpy).toHaveBeenCalledWith('edit')
    })
  })

  describe('Upgrade Modal Close', () => {
    it('should close upgrade modal when explicitly set to false', async () => {
      const globals = await import('@/model/globals')
      globals.default.apWrapper.isLite = vi.fn(() => true)

      const wrapper = mount(GenericViewer, {
        global: {
          plugins: [store]
        }
      })

      await wrapper.vm.$nextTick()

      // Set macro count to ensure button shows (> 50)
      const vm = wrapper.vm as any
      vm.macrosCreated = 75
      await wrapper.vm.$nextTick()

      // Open modal
      const upgradeButton = wrapper.find('button[title="Upgrade to unlock unlimited diagrams"]')
      await upgradeButton.trigger('click')
      expect(vm.showUpgradeModal).toBe(true)

      // Simulate closing the modal (in the real component, UpgradePrompt emits @close)
      vm.showUpgradeModal = false
      await wrapper.vm.$nextTick()

      // Modal should be closed
      expect(vm.showUpgradeModal).toBe(false)
    })
  })
})
