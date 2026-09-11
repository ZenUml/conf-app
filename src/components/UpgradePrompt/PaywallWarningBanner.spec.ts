import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PaywallWarningBanner from './PaywallWarningBanner.vue'

const warningMarker = {
  severity: 'critical',
  macroCount: 101,
  spacePaid: false,
  customerSuccessServiceEnabled: true,
  updatedAt: 'x',
}

// Mutable gate result the marker-module mock returns; flipped per test.
// `isAdmin` drives the Phase 5b audience split.
const gate = { visible: true, targeting: warningMarker as any, isAdmin: false, dismissal: null as any }

vi.mock('@/utils/paywall/warningBanner', () => ({
  deriveWarningBannerIdentity: () => ({ clientDomain: 'example-tenant', spaceKey: 'ENG' }),
  readTargetingMarker: () => gate.targeting,
  readMacroActivityMarker: () => ({ lastActivityAt: '2026-06-03T00:00:00.000Z', activityType: 'edit' }),
  readDismissalMarker: () => gate.dismissal,
  isWarningBannerVisible: () => gate.visible,
  bannerAudience: (isAdmin: boolean) => (isAdmin ? 'space_admin' : 'editor'),
  recordBannerShown: vi.fn(),
  recordBannerDismissed: vi.fn(),
}))

vi.mock('@/utils/paywall/spaceAdminProbe', () => ({
  isCurrentUserSpaceAdmin: () => gate.isAdmin,
  readProbeMarker: () => ({ lastProbedAt: 'x', isAdmin: gate.isAdmin, adminCount: 3 }),
}))

const closeView = vi.fn()

// Keep the real module (enum + bundleClientReferenceId) and stub only the
// tracker — the component parses client_reference_id off the bundle URL via
// the real helper at click time.
vi.mock('@/utils/upgradeTracking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/upgradeTracking')>()
  return { ...actual, trackUpgradeEvent: vi.fn() }
})

vi.mock('@/composables/useCustomerSuccessService', () => ({
  // The component only reads `.value` on these (pure URL refs), so plain
  // { value } stand-ins suffice — no need to import vue's ref into the factory.
  useCustomerSuccessService: () => ({
    upgradeUrl: { value: 'https://upgrade.example.com' },
    enterpriseBundleUrl: { value: 'https://bundle.example.com/pay?client_reference_id=acme__ENG' },
  }),
  MACROS_LIMIT: 100,
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: null },
  getView: vi.fn(() => Promise.resolve({ close: closeView })),
  openUrl: vi.fn(),
}))

describe('PaywallWarningBanner (page banner)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gate.visible = true
    gate.targeting = warningMarker
    gate.isAdmin = false
    gate.dismissal = null
  })

  // Impression taper (2026-09-07). The impression event carries where this
  // user sits in the taper so the schedule is verifiable from Mixpanel alone.
  it('reports the impression ordinal and the gap since the previous one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
    gate.dismissal = { dismissedAt: null, lastShownAt: '2026-06-09T00:00:00.000Z', showCount: 2 }
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    try {
      mount(PaywallWarningBanner)
      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'paywall_banner_shown',
        // show_count is the ordinal of THIS impression (prior 2 -> this is the 3rd).
        expect.objectContaining({ show_count: 3, hours_since_last_shown: 36 })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports show_count 1 and omits the gap on a first impression', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    mount(PaywallWarningBanner)
    const call = vi.mocked(trackUpgradeEvent).mock.calls.find(([name]) => name === 'paywall_banner_shown')
    expect(call?.[1]).toEqual(expect.objectContaining({ show_count: 1 }))
    expect(call?.[1]).not.toHaveProperty('hours_since_last_shown')
  })

  it('renders and records an impression when the gate passes', async () => {
    const { recordBannerShown } = await import('@/utils/paywall/warningBanner')
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mount(PaywallWarningBanner)

    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('101 of 100')
    expect(recordBannerShown).toHaveBeenCalledOnce()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_shown',
      expect.objectContaining({ surface: 'page_banner', severity: 'critical', macro_count: 101 })
    )
  })

  it('closes the iframe and renders nothing when the gate fails', async () => {
    gate.visible = false
    const { recordBannerShown } = await import('@/utils/paywall/warningBanner')
    const wrapper = mount(PaywallWarningBanner)

    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
    await vi.waitFor(() => expect(closeView).toHaveBeenCalledOnce())
    expect(recordBannerShown).not.toHaveBeenCalled()
  })

  it('snoozes (records dismissal) and closes on dismiss', async () => {
    const { recordBannerDismissed } = await import('@/utils/paywall/warningBanner')
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mount(PaywallWarningBanner)

    await wrapper.find('[data-testid="paywall-banner-dismiss"]').trigger('click')

    expect(recordBannerDismissed).toHaveBeenCalledOnce()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_dismissed',
      expect.objectContaining({ surface: 'page_banner' })
    )
    await vi.waitFor(() => expect(closeView).toHaveBeenCalled())
    expect(wrapper.find('[data-testid="paywall-warning-banner"]').exists()).toBe(false)
  })

  it('tags every banner event with the audience so the funnel can be split', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    mount(PaywallWarningBanner)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_banner_shown',
      expect.objectContaining({ is_space_admin: false, banner_audience: 'editor', space_admin_count: 3 })
    )
  })

  // Phase 5b. Telling a space admin to "copy a message to your admin" is
  // circular, and that relay has produced zero conversions in 15 months. An
  // admin instead gets the one purchase they can complete unaided.
  describe('space-admin audience', () => {
    // The audience arrives as a prop from the page-banner host, which is where
    // the Phase 5b flag is resolved — the component never re-derives it.
    const asAdmin = { props: { isSpaceAdmin: true } }

    beforeEach(() => {
      gate.isAdmin = true
    })

    it('renders the author copy when the host does not mark the user as an admin', () => {
      const wrapper = mount(PaywallWarningBanner)
      expect(wrapper.find('[data-testid="paywall-banner-unlock-space"]').exists()).toBe(false)
    })

    it('swaps the advocacy relay for a direct purchase CTA', () => {
      const wrapper = mount(PaywallWarningBanner, asAdmin)
      expect(wrapper.text()).toContain('You administer this space')
      expect(wrapper.find('[data-testid="paywall-banner-unlock-space"]').exists()).toBe(true)
    })

    it('quotes the bundle price on the CTA', () => {
      const wrapper = mount(PaywallWarningBanner, asAdmin)
      expect(wrapper.find('[data-testid="paywall-banner-unlock-space"]').text()).toContain('$299')
    })

    it('opens the bundle checkout and tracks the click with the price', async () => {
      const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
      const { openUrl } = await import('@/model/globals/forgeGlobal')
      const wrapper = mount(PaywallWarningBanner, asAdmin)

      await wrapper.find('[data-testid="paywall-banner-unlock-space"]').trigger('click')

      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'paywall_bundle_cta_clicked',
        expect.objectContaining({
          surface: 'page_banner',
          bundle_price_usd: 299,
          is_space_admin: true,
          banner_audience: 'space_admin',
          client_reference_id: 'acme__ENG',
        })
      )
      expect(openUrl).toHaveBeenCalledWith('https://bundle.example.com/pay?client_reference_id=acme__ENG')
    })

    it('tags the impression as the space_admin audience', async () => {
      const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
      mount(PaywallWarningBanner, asAdmin)
      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'paywall_banner_shown',
        expect.objectContaining({ is_space_admin: true, banner_audience: 'space_admin' })
      )
    })
  })
})
