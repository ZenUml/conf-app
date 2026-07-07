import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import UpgradePrompt from './UpgradePrompt.vue'

// The modal is the paywall's only enforcement point, so these specs pin the
// dismissal contract: exhausted attempts on an editor surface must NOT close
// (and must emit paywall_dismiss_blocked); the fullscreen viewer must always
// stay dismissible so existing diagrams remain viewable.

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    MODAL_SHOWN: 'upgrade_modal_shown',
    MODAL_DISMISSED: 'upgrade_modal_dismissed',
    PAYWALL_DISMISS_BLOCKED: 'paywall_dismiss_blocked',
    PAYWALL_CONTINUED_EDITING: 'paywall_continued_editing',
    PAYWALL_CONTINUE_USED: 'paywall_continue_used',
    PAYWALL_ATTEMPTS_EXHAUSTED: 'paywall_attempts_exhausted',
    ADVOCACY_MESSAGE_COPIED: 'advocacy_message_copied',
    ADVOCACY_DRAFT_PREVIEW_CLICKED: 'advocacy_draft_preview_clicked',
    EXTENSION_REQUEST_CLICKED: 'extension_request_clicked',
  },
  UIComponent: { MODAL: 'modal' },
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => ({ spaceKey: { value: 'ENG' } }),
  getUpgradeContext: () => ({ space_key: 'ENG', macro_count: 150, macro_limit: 100 }),
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: null },
  openUrl: vi.fn(),
}))

const baseProps = {
  visible: true,
  macrosCreated: 150,
  macrosLimit: 100,
  upgradeUrl: 'https://upgrade.example.com',
  enterpriseBundleUrl: 'https://bundle.example.com',
  macroKind: 'sequence' as const,
}

function mountPrompt(props: Record<string, unknown>) {
  return mount(UpgradePrompt, {
    props: { ...baseProps, ...props },
    // Render the teleported modal inline and skip heavy hero/draft children —
    // only the backdrop + root dismissal wiring is under test here.
    global: {
      stubs: {
        teleport: true,
        PaywallHero: true,
        DraftCard: true,
        AdvocacyButton: true,
      },
    },
  })
}

describe('UpgradePrompt dismissal gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks backdrop dismissal when exhausted on the page editor', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mountPrompt({ actionType: 'page_editor', remainingContinueAttempts: 0 })

    await wrapper.find('[data-testid="paywall-backdrop"]').trigger('click')

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(trackUpgradeEvent).not.toHaveBeenCalledWith(
      'upgrade_modal_dismissed',
      expect.anything()
    )
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_dismiss_blocked',
      expect.objectContaining({ action_type: 'page_editor', ui_component: 'modal' })
    )
  })

  it('blocks Esc dismissal when exhausted on the page editor', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mountPrompt({ actionType: 'page_editor', remainingContinueAttempts: 0 })

    await wrapper.find('[data-testid="paywall-modal-root"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(trackUpgradeEvent).not.toHaveBeenCalledWith(
      'upgrade_modal_dismissed',
      expect.anything()
    )
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_dismiss_blocked',
      expect.objectContaining({ action_type: 'page_editor', ui_component: 'modal' })
    )
  })

  it('still dismisses the fullscreen viewer when exhausted (diagrams stay viewable)', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mountPrompt({ actionType: 'fullscreen_viewer', remainingContinueAttempts: 0 })

    await wrapper.find('[data-testid="paywall-backdrop"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_modal_dismissed',
      expect.anything()
    )
    expect(trackUpgradeEvent).not.toHaveBeenCalledWith(
      'paywall_dismiss_blocked',
      expect.anything()
    )
  })

  it('dismisses normally when attempts remain on the page editor', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mountPrompt({ actionType: 'page_editor', remainingContinueAttempts: 5 })

    await wrapper.find('[data-testid="paywall-backdrop"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_modal_dismissed',
      expect.anything()
    )
    expect(trackUpgradeEvent).not.toHaveBeenCalledWith(
      'paywall_dismiss_blocked',
      expect.anything()
    )
  })
})
