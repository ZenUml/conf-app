import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import UpgradePrompt from './UpgradePrompt.vue'

/**
 * The paywall modal shipped for four months with NO purchase surface: its only
 * actions were "copy a message for someone else", "ask us for a free
 * extension", and "continue anyway". The Marketplace URL and the $299 price
 * existed solely inside the copied advocacy text — `MarketplacePricingCard.vue`
 * and `EnterpriseBundleCard.vue` were deleted in 05b5287f (2026-05-12).
 *
 * These tests pin the two purchase rails in place so the surface cannot be
 * quietly removed again, and so the rails stay distinguishable — they require
 * different people. The bundle needs nobody; Marketplace needs a Confluence
 * SITE admin, which most people hitting this modal are not.
 */

vi.mock('@/utils/upgradeTracking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/upgradeTracking')>()
  return { ...actual, trackUpgradeEvent: vi.fn() }
})

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: null },
  openUrl: vi.fn(),
  getView: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => ({ spaceKey: { value: 'ENG' } }),
  getUpgradeContext: () => ({ macro_count: 147, macro_limit: 100 }),
}))

// The hero pulls in an illustration asset; stub it, it is irrelevant here.
vi.mock('./PaywallHero.vue', () => ({ default: { template: '<div />' } }))

const BASE_PROPS = {
  visible: true,
  macrosCreated: 147,
  macrosLimit: 100,
  upgradeUrl: 'https://marketplace.example.com/apps/1218380?domain=acme',
  enterpriseBundleUrl: 'https://buy.stripe.example.com/bundle',
}

function mountModal(extra: Record<string, unknown> = {}) {
  // The modal body is inside <Teleport to="body">, which the test wrapper does
  // not follow; stubbing teleport renders it in place so find() reaches it.
  return mount(UpgradePrompt, {
    props: { ...BASE_PROPS, ...extra },
    global: { stubs: { teleport: true } },
  })
}

describe('UpgradePrompt — purchase surface', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers a self-serve bundle purchase, priced', () => {
    const btn = mountModal().find('[data-testid="unlock-space-btn"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('$299')
  })

  it('says the bundle needs no Confluence admin — the reason it is the primary rail', () => {
    expect(mountModal().text()).toMatch(/no Confluence admin/i)
  })

  it('offers the Marketplace rail as well, flagged as needing a site admin', () => {
    const wrapper = mountModal()
    expect(wrapper.find('[data-testid="marketplace-cta"]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/site admin/i)
  })

  it('opens the Stripe checkout and tracks the bundle rail', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const { openUrl } = await import('@/model/globals/forgeGlobal')
    const wrapper = mountModal()

    await wrapper.find('[data-testid="unlock-space-btn"]').trigger('click')

    expect(openUrl).toHaveBeenCalledWith(BASE_PROPS.enterpriseBundleUrl)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_bundle_cta_clicked',
      expect.objectContaining({ bundle_price_usd: 299, ui_component: 'modal' })
    )
  })

  it('records the Stripe attribution token (client_reference_id) on the bundle click', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mountModal({
      enterpriseBundleUrl: 'https://buy.stripe.example.com/bundle?client_reference_id=acme__ENG',
    })

    await wrapper.find('[data-testid="unlock-space-btn"]').trigger('click')

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_bundle_cta_clicked',
      expect.objectContaining({ client_reference_id: 'acme__ENG' })
    )
  })

  it('opens the Marketplace listing and tracks the OTHER rail distinctly', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const { openUrl } = await import('@/model/globals/forgeGlobal')
    const wrapper = mountModal()

    await wrapper.find('[data-testid="marketplace-cta"]').trigger('click')

    expect(openUrl).toHaveBeenCalledWith(BASE_PROPS.upgradeUrl)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_marketplace_cta_clicked',
      expect.objectContaining({ ui_component: 'modal' })
    )
  })

  it('carries the action_type so the rails can be split by which surface was gated', async () => {
    const { trackUpgradeEvent } = await import('@/utils/upgradeTracking')
    const wrapper = mountModal({ actionType: 'fullscreen_viewer' })

    await wrapper.find('[data-testid="unlock-space-btn"]').trigger('click')

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_bundle_cta_clicked',
      expect.objectContaining({ action_type: 'fullscreen_viewer' })
    )
  })

  // Ordering is the argument, not decoration: fix-it-yourself must precede
  // ask-someone-else, or we have rebuilt the relay with a price tag on it.
  it('places the purchase surface above the advocacy relay', () => {
    const html = mountModal().html()
    expect(html.indexOf('unlock-space-btn')).toBeGreaterThan(-1)
    expect(html.indexOf('unlock-space-btn')).toBeLessThan(html.indexOf('draft-toggle-btn'))
  })

  it('keeps the existing escape hatches intact', () => {
    const wrapper = mountModal({ remainingContinueAttempts: 15 })
    expect(wrapper.find('[data-testid="request-extension-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="continue-editing-btn"]').exists()).toBe(true)
  })
})
