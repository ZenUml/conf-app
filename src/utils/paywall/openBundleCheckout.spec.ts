import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/model/globals/forgeGlobal', () => ({ openUrlForOutcome: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
import { openUrlForOutcome } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { openBundleCheckout } from './openBundleCheckout'

const URL_ = 'https://conf-lite.zenuml.com/bundle-checkout?ref=example__ENG&space=ENG&surface=plan_usage&click=click-0001'

describe('openBundleCheckout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends nothing when the page opens; the server counts opens', async () => {
    vi.mocked(openUrlForOutcome).mockResolvedValue('opened')
    expect(await openBundleCheckout(URL_, { surface: 'dashboard', checkoutSurface: 'plan_usage' })).toBe('opened')
    expect(openUrlForOutcome).toHaveBeenCalledWith(URL_)
    expect(trackAnalyticsEvent).not.toHaveBeenCalled()
  })

  it.each(['declined', 'error'] as const)('records bundle_checkout_open_result when the open is %s', async (outcome) => {
    vi.mocked(openUrlForOutcome).mockResolvedValue(outcome)
    expect(await openBundleCheckout(URL_, { surface: 'modal', checkoutSurface: 'upgrade_prompt' })).toBe(outcome)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('bundle_checkout_open_result', {
      feature_area: 'upgrade',
      surface: 'modal',
      checkout_surface: 'upgrade_prompt',
      client_reference_id: 'example__ENG',
      checkout_click_id: 'click-0001',
      checkout_open_outcome: outcome,
    })
  })
})
