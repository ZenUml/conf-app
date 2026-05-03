import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCustomerSuccessService } from './useCustomerSuccessService'

// Mock dependencies
vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn().mockResolvedValue({ CUSTOMER_SUCCESS_SERVICE: true })
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
  getClientDomain: vi.fn().mockReturnValue('test-domain')
}))

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: vi.fn().mockReturnValue(true)
    }
  }
}))

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

  it('should block actions when space is not paid and over limit', async () => {
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
    expect(shouldBlockActions.value).toBe(true) // Should block because unpaid and over 100
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