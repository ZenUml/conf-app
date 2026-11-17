import { describe, it, expect, beforeEach, vi } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import {
  deriveWarningBannerIdentity,
  macroActivityMarkerKey,
  shouldShowPaywallBanner,
  targetingMarkerKey,
} from './warningBanner'
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'

/**
 * Regression, lite-stg 2026-11-08: after a Confluence SPA navigation by quick
 * find the page-banner iframe receives the new `content.id` and `location`, and
 * the previous page's `space`. Nothing here mocks the identity helpers: the
 * point is that the whole chain, context to localStorage key, reads the space
 * the page is really in.
 */
vi.mock('@/model/globals/forgeGlobal', () => ({ default: { isForge: true, forgeContext: null } }))
vi.mock('@/apis/featureFlags', () => ({ default: vi.fn().mockResolvedValue({}) }))
vi.mock('@/services/MacroMetrics', () => ({ default: { getMacroMetrics: vi.fn() } }))
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
vi.mock('@/utils/window', () => ({ getUrlParam: vi.fn(), trackEvent: vi.fn() }))
vi.mock('@/model/globals', () => ({ default: { apWrapper: { isLite: () => true, getCurrentSpace: vi.fn() } } }))
vi.mock('@/utils/cohorts/userCohorts', () => ({ refreshUserCohortsIfStale: vi.fn() }))

const SITE = 'https://example-tenant.atlassian.net'
const NOW = Date.parse('2026-11-08T12:00:00.000Z')

function bannerContext(contextKey: string, pageSpaceKey: string) {
  vi.mocked(forgeGlobal).forgeContext = {
    siteUrl: SITE,
    extension: {
      type: 'confluence:pageBanner',
      space: { key: contextKey, id: '65802' },
      content: { id: '200' },
      location: `${SITE}/wiki/spaces/${pageSpaceKey}/pages/200/Title`,
    },
  } as any
}

function overLimit(spaceKey: string) {
  const identity = { clientDomain: 'example-tenant', spaceKey }
  localStorage.setItem(
    targetingMarkerKey(identity),
    JSON.stringify({
      severity: 'critical',
      macroCount: 48203,
      spacePaid: false,
      customerSuccessServiceEnabled: true,
      updatedAt: new Date(NOW).toISOString(),
    })
  )
  localStorage.setItem(
    macroActivityMarkerKey(identity),
    JSON.stringify({ lastActivityAt: new Date(NOW - 1000).toISOString(), activityType: 'edit' })
  )
}

describe('paywall page banner after an SPA navigation between spaces', () => {
  beforeEach(() => {
    localStorage.clear()
    ;(useCustomerSuccessService as any).__resetForTests()
  })

  it("does not show the previous space's warning on a page in a clean space", () => {
    overLimit('SD')
    bannerContext('SD', '~abc')
    expect(deriveWarningBannerIdentity().spaceKey).toBe('~abc')
    expect(shouldShowPaywallBanner(NOW)).toBe(false)
  })

  it('shows the warning on arrival at an over-limit space from a clean one', () => {
    overLimit('SD')
    bannerContext('~abc', 'SD')
    expect(deriveWarningBannerIdentity().spaceKey).toBe('SD')
    expect(shouldShowPaywallBanner(NOW)).toBe(true)
  })

  it('bills the Unlock this space purchase to the space the page is in', () => {
    bannerContext('SD', 'ENG')
    const url = new URL(useCustomerSuccessService().enterpriseBundleUrl.value)
    expect(url.searchParams.get('client_reference_id')).toBe('example-tenant__ENG')
  })
})
