import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCustomerSuccessService } from './useCustomerSuccessService'
import { getSpaceKey } from '@/utils/ContextParameters/ContextParameters'

// Mock dependencies
vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn().mockResolvedValue({ PAYWALL_EXEMPT: false })
}))

vi.mock('@/services/MacroMetrics', () => ({
  default: {
    getMacroMetrics: vi.fn().mockResolvedValue({ total: 50 })
  }
}))

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn()
}))

vi.mock('@/utils/window', () => ({
  getUrlParam: vi.fn(),
  trackEvent: vi.fn()
}))

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn().mockReturnValue('test-domain'),
  getSpaceKey: vi.fn().mockReturnValue('ENG')
}))

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: vi.fn().mockReturnValue(true),
      getCurrentSpace: vi.fn().mockResolvedValue({ key: 'ENG' })
    }
  }
}))

vi.mock('@/utils/cohorts/userCohorts', () => ({ refreshUserCohortsIfStale: vi.fn() }))

describe('useCustomerSuccessService - Paid Space Detection', () => {
  beforeEach(async () => {
    // Clear localStorage before each test
    localStorage.clear()
    // Reset all module states to ensure clean test environment
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should not block actions when space is paid', async () => {
    const { callRemote } = await import('@/utils/requestUtil')

    // Mock space status API to return paid status
    vi.mocked(callRemote).mockResolvedValue({
      isPaid: true,
      source: 'lic_param',
      licenseStatus: 'active'
    })

    // Set mock values to trigger restrictions (100+ macros)
    localStorage.mockMacroCount = '150'
    localStorage.mockCSSEnabled = 'true'

    const { shouldBlockActions, spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(true)
    expect(shouldBlockActions.value).toBe(false) // Should NOT block despite 150 macros
  })

  it('does not block actions even when space is not paid and over limit (paywall block retired)', async () => {
    const { callRemote } = await import('@/utils/requestUtil')

    // Mock space status API to return unpaid status
    vi.mocked(callRemote).mockResolvedValue({
      isPaid: false,
      source: 'lic_param',
      licenseStatus: 'evaluation'
    })

    // Set mock values to trigger restrictions (100+ macros)
    localStorage.mockMacroCount = '150'
    localStorage.mockCSSEnabled = 'true'

    // Re-import to get fresh module state
    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { shouldBlockActions, spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(false)
    // Retired 2026-09: the paywall no longer blocks editing at any macro count.
    expect(shouldBlockActions.value).toBe(false)
  })

  it('should not show action required when space is paid', async () => {
    const { callRemote } = await import('@/utils/requestUtil')

    // Mock space status API to return paid status
    vi.mocked(callRemote).mockResolvedValue({
      isPaid: true,
      source: 'forge_context',
      accountType: 'licensed'
    })

    // Set mock values that would normally trigger warning (85+ macros)
    localStorage.mockMacroCount = '90'
    localStorage.mockCSSEnabled = 'true'

    const { actionRequired, spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(true)
    expect(actionRequired.value).toBe(false) // Should NOT require action despite 90 macros
  })

  it('should use mock space paid status from localStorage', async () => {
    // Set mock space paid status
    localStorage.mockSpacePaid = 'true'
    localStorage.mockMacroCount = '150'
    localStorage.mockCSSEnabled = 'true'

    const { shouldBlockActions, spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(true)
    expect(shouldBlockActions.value).toBe(false)
  })

  it('should detect paid status from Forge context', async () => {
    const { callRemote } = await import('@/utils/requestUtil')

    // Mock Forge context response
    vi.mocked(callRemote).mockResolvedValue({
      isPaid: true,
      source: 'forge_context',
      accountType: 'licensed'
    })

    const { spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(true)
  })

  it('should detect unpaid status from lic parameter', async () => {
    const { callRemote } = await import('@/utils/requestUtil')
    const { getUrlParam } = await import('@/utils/window')

    // Mock lic parameter
    vi.mocked(getUrlParam).mockReturnValue('evaluation')

    // Mock API response
    vi.mocked(callRemote).mockResolvedValue({
      isPaid: false,
      source: 'lic_param',
      licenseStatus: 'evaluation'
    })

    // Re-import to get fresh module state
    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(false)
  })
})

describe('useCustomerSuccessService - space paid source (hybrid extension)', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exposes spacePaidSource as user_license from the space-status response', async () => {
    const { callRemote } = await import('@/utils/requestUtil')
    vi.mocked(callRemote).mockResolvedValue({ isPaid: true, source: 'user_license' })

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { spacePaidSource, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaidSource.value).toBe('user_license')
  })

  it('exposes spacePaidSource as space_license from the space-status response', async () => {
    const { callRemote } = await import('@/utils/requestUtil')
    vi.mocked(callRemote).mockResolvedValue({ isPaid: true, source: 'space_license' })

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { spacePaidSource, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaidSource.value).toBe('space_license')
  })

  it('leaves spacePaidSource undefined when the space is not paid', async () => {
    const { callRemote } = await import('@/utils/requestUtil')
    vi.mocked(callRemote).mockResolvedValue({ isPaid: false })

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { spacePaidSource, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaidSource.value).toBeUndefined()
  })
})

describe('useCustomerSuccessService - Full App (no restrictions)', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    vi.clearAllMocks()

    const globals = await import('@/model/globals')
    vi.mocked(globals.default.apWrapper.isLite).mockReturnValue(false)
  })

  it('should skip space-status API call for Full app', async () => {
    const { callRemote } = await import('@/utils/requestUtil')

    localStorage.mockMacroCount = '150'
    localStorage.mockCSSEnabled = 'true'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { spacePaid, initialize } = useCustomerSuccessService()

    await initialize()

    expect(spacePaid.value).toBe(true)
    expect(callRemote).not.toHaveBeenCalled()
  })

  it('should not block actions for Full app regardless of macro count', async () => {
    localStorage.mockMacroCount = '150'
    localStorage.mockCSSEnabled = 'true'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { shouldBlockActions, initialize } = useCustomerSuccessService()

    await initialize()

    expect(shouldBlockActions.value).toBe(false)
  })

  it('should not require action for Full app regardless of macro count', async () => {
    localStorage.mockMacroCount = '90'
    localStorage.mockCSSEnabled = 'true'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { actionRequired, initialize } = useCustomerSuccessService()

    await initialize()

    expect(actionRequired.value).toBe(false)
  })
})

describe('useCustomerSuccessService - paywall policy source (lite-paywall-default-on)', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    vi.clearAllMocks()

    // vi.clearAllMocks() resets call history but NOT a prior
    // mockReturnValue() — the "Full App" describe above this one leaves
    // isLite() permanently stubbed to false unless every later block
    // restores it explicitly.
    const globals = await import('@/model/globals')
    vi.mocked(globals.default.apWrapper.isLite).mockReturnValue(true)

    const { callRemote } = await import('@/utils/requestUtil')
    vi.mocked(callRemote).mockResolvedValue({ isPaid: false })
  })

  it('Lite + PAYWALL_EXEMPT:false resolves default_on and enables the paywall', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({ PAYWALL_EXEMPT: false })

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('default_on')
    expect(svc.cssEnabled.value).toBe(true)
  })

  it('Lite + PAYWALL_EXEMPT:true resolves exemption and disables the paywall', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({ PAYWALL_EXEMPT: true })

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('exemption')
    expect(svc.cssEnabled.value).toBe(false)
  })

  it('Lite + an empty feature-flags response resolves fail_open and disables the paywall', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({})

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('fail_open')
    expect(svc.cssEnabled.value).toBe(false)
  })

  it('Lite + a rejected feature-flags call resolves fail_open and disables the paywall', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockRejectedValue(new Error('network down'))

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('fail_open')
    expect(svc.cssEnabled.value).toBe(false)
  })

  it('non-Lite resolves the fail_open compatibility state and never requests PAYWALL_EXEMPT', async () => {
    const globals = await import('@/model/globals')
    vi.mocked(globals.default.apWrapper.isLite).mockReturnValue(false)
    const getFeatureFlags = (await import('@/apis/featureFlags')).default

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('fail_open')
    expect(svc.cssEnabled.value).toBe(false)
    expect(getFeatureFlags).not.toHaveBeenCalled()
  })

  it('mockCSSEnabled=true maps to effective default_on for test/dev use', async () => {
    localStorage.mockCSSEnabled = 'true'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('default_on')
    expect(svc.cssEnabled.value).toBe(true)
  })

  it('mockCSSEnabled=false maps to effective exemption for test/dev use', async () => {
    localStorage.mockCSSEnabled = 'false'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('exemption')
    expect(svc.cssEnabled.value).toBe(false)
  })

  it('default_on warns at 85 macros in an unpaid space (below the block threshold)', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({ PAYWALL_EXEMPT: false })
    localStorage.mockMacroCount = '85'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.actionRequired.value).toBe(true)
    expect(svc.shouldBlockActions.value).toBe(false)
  })

  it('default_on no longer blocks at 100 macros in an unpaid space (paywall block retired)', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({ PAYWALL_EXEMPT: false })
    localStorage.mockMacroCount = '100'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.shouldBlockActions.value).toBe(false)
  })

  it('an explicit exemption disables both the warning and the block at the same counts', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({ PAYWALL_EXEMPT: true })
    localStorage.mockMacroCount = '150'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.actionRequired.value).toBe(false)
    expect(svc.shouldBlockActions.value).toBe(false)
  })

  it('a user/space license still overrides a real (non-mocked) default_on decision', async () => {
    const getFeatureFlags = (await import('@/apis/featureFlags')).default
    vi.mocked(getFeatureFlags).mockResolvedValue({ PAYWALL_EXEMPT: false })
    const { callRemote } = await import('@/utils/requestUtil')
    vi.mocked(callRemote).mockResolvedValue({ isPaid: true, source: 'space_license' })
    localStorage.mockMacroCount = '150'

    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const svc = useCustomerSuccessService()
    await svc.initialize()

    expect(svc.paywallPolicySource.value).toBe('default_on')
    expect(svc.shouldBlockActions.value).toBe(false)
  })
})

describe('useCustomerSuccessService - cohort refresh wiring', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
    vi.clearAllMocks()
  })

  // Cohort refresh moved OUT of this composable and up into forgeIndex.ts,
  // called unconditionally (no isLite() gate) alongside — not inside —
  // useCustomerSuccessService().initialize(). This composable's name and
  // contents are customer-success / paywall specific; the cohort pipeline is
  // variant-agnostic (KV allow-list keyed globally by accountId) and
  // shouldn't be reachable only through the isLite()-gated / paywall-gated
  // call sites that happened to invoke initialize(). See forgeIndex.ts for
  // the new call site and the comment explaining why it runs outside the
  // isLite() block.
  it('initialize does NOT trigger a cohort refresh (moved to forgeIndex.ts)', async () => {
    // Both the composable and the cohorts mock must be re-imported after
    // vi.resetModules() so they come from the same module generation —
    // otherwise the composable's internal reference would point at a
    // different (pre-reset) mock instance than the one this test inspects.
    const { refreshUserCohortsIfStale } = await import('@/utils/cohorts/userCohorts')
    const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
    const { initialize } = useCustomerSuccessService()

    await initialize()

    expect(refreshUserCohortsIfStale).not.toHaveBeenCalled()
  })
})

describe('useCustomerSuccessService - enterprise bundle attribution', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(getSpaceKey).mockReturnValue('ENG')
    ;(useCustomerSuccessService as any).__resetForTests()
  })

  it('rides a tenant__space client_reference_id on the Stripe Payment Link', () => {
    const { enterpriseBundleUrl } = useCustomerSuccessService()
    const url = new URL(enterpriseBundleUrl.value)
    expect(`${url.origin}${url.pathname}`).toBe('https://buy.stripe.com/cNifZifkN7hzavK12H7IY05')
    expect(url.searchParams.get('client_reference_id')).toBe('test-domain__ENG')
  })

  it('sanitises characters Stripe rejects — a personal space key ("~…") must not void the parameter', () => {
    vi.mocked(getSpaceKey).mockReturnValue('~7120201234abc')
    const { enterpriseBundleUrl } = useCustomerSuccessService()
    const reference = new URL(enterpriseBundleUrl.value).searchParams.get('client_reference_id')
    expect(reference).toBe('test-domain___7120201234abc')
    expect(reference).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
