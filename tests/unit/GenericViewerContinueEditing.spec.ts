import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    PAYWALL_BLOCKED_EDIT: 'paywall_blocked_edit',
    PAYWALL_TRIGGERED: 'paywall_triggered',
  },
  UIComponent: { VIEWER_NOTICE: 'viewer_notice' },
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => ({
    macrosCreated: { value: 100 },
    severity: { value: 'critical' },
    shouldBlockActions: { value: true },
    upgradeUrl: { value: 'https://m' },
    enterpriseBundleUrl: { value: 'https://b' },
    initialize: vi.fn(),
    spacePaid: { value: false },
  }),
  MACROS_LIMIT: 100,
  getUpgradeContext: () => ({}),
}))

vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }))

import EventBus from '@/EventBus'

interface ViewerLike {
  shouldBlockActions: boolean
  showUpgradeModal: boolean
  pendingEditAction: boolean
  edit: () => void
  openUpgradeModal: () => void
  onCloseUpgradeModal: () => void
  onContinueEditing: () => void
}

function createViewer(): ViewerLike {
  const state: ViewerLike = {
    shouldBlockActions: true,
    showUpgradeModal: false,
    pendingEditAction: false,
    edit() {
      if (this.shouldBlockActions) {
        this.pendingEditAction = true
        this.showUpgradeModal = true
        return
      }
      EventBus.$emit('edit')
    },
    openUpgradeModal() {
      this.pendingEditAction = false
      this.showUpgradeModal = true
    },
    onCloseUpgradeModal() {
      this.pendingEditAction = false
      this.showUpgradeModal = false
    },
    onContinueEditing() {
      const wasEditAction = this.pendingEditAction
      this.pendingEditAction = false
      this.showUpgradeModal = false
      if (wasEditAction) {
        EventBus.$emit('edit')
      }
    },
  }
  return state
}

describe('GenericViewer continue-editing handler', () => {
  let editSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    editSpy = vi.fn()
    EventBus.$on('edit', editSpy)
  })

  it('closes the modal and emits edit when modal was opened from blocked Edit click', () => {
    const v = createViewer()
    v.edit()
    expect(v.showUpgradeModal).toBe(true)
    expect(v.pendingEditAction).toBe(true)

    v.onContinueEditing()

    expect(v.showUpgradeModal).toBe(false)
    expect(v.pendingEditAction).toBe(false)
    expect(editSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the modal but does NOT emit edit when modal was opened from the upgrade badge', () => {
    const v = createViewer()
    v.openUpgradeModal()
    expect(v.showUpgradeModal).toBe(true)
    expect(v.pendingEditAction).toBe(false)

    v.onContinueEditing()

    expect(v.showUpgradeModal).toBe(false)
    expect(v.pendingEditAction).toBe(false)
    expect(editSpy).not.toHaveBeenCalled()
  })

  it('clears pendingEditAction when modal is dismissed via close (Escape, backdrop, ×)', () => {
    const v = createViewer()
    v.edit()
    expect(v.pendingEditAction).toBe(true)

    v.onCloseUpgradeModal()

    expect(v.showUpgradeModal).toBe(false)
    expect(v.pendingEditAction).toBe(false)
    expect(editSpy).not.toHaveBeenCalled()
  })
})
