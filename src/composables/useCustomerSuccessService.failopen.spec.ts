import { describe, it, expect, beforeEach, vi } from 'vitest'

// Originally a reproduction + instrumentation test for issue #302 (the Lite
// paywall gate was fail-open on the macro-count read: a rejected/undefined/
// zero-total read left the count at 0, so the block never fired on an
// over-limit space). Retired 2026-09: `shouldBlockActions` is now hardcoded
// `false` (the paywall no longer blocks editing at any macro count — see
// useCustomerSuccessService.ts), so the fail-open distinction is moot for
// blocking. Kept to assert `macroCountSource` still classifies each read
// outcome correctly, since `paywall_gate_evaluated.macro_count_source` still
// reports it.

vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn().mockResolvedValue({ PAYWALL_EXEMPT: false }),
}))

// Unpaid space so spacePaid can't independently disable the gate.
vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn().mockResolvedValue({ isPaid: false, source: 'lic_param' }),
}))

vi.mock('@/utils/window', () => ({
  getUrlParam: vi.fn(),
  trackEvent: vi.fn(),
}))

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn().mockReturnValue('example-tenant'),
  getSpaceKey: vi.fn().mockReturnValue('OVERLIMIT'),
}))

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isLite: vi.fn().mockReturnValue(true),
      getCurrentSpace: vi.fn().mockResolvedValue({ key: 'OVERLIMIT' }),
    },
  },
}))

// The metrics service is the fail-open surface under test.
vi.mock('@/services/MacroMetrics', () => ({
  default: { getMacroMetrics: vi.fn() },
}))

async function freshService() {
  vi.resetModules()
  const { useCustomerSuccessService } = await import('./useCustomerSuccessService')
  return useCustomerSuccessService()
}

const overLimit = (extra: Record<string, unknown>) => ({
  space: 'OVERLIMIT', total: 150, sequence: 150, graph: 0, openapi: 0,
  mermaid: 0, plantuml: 0, asyncapi: 0, unknown: 0, isLite: true, ...extra,
})

describe('#302 fail-open: over-limit Lite space, macro-count read fails', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('REJECT → gate does NOT fire, source = undefined', async () => {
    const { default: macroMetrics } = await import('@/services/MacroMetrics')
    vi.mocked(macroMetrics.getMacroMetrics).mockRejectedValue(new Error('D1 down'))
    const svc = await freshService()
    await svc.initialize()
    expect(svc.macrosCreated.value).toBe(0)
    expect(svc.shouldBlockActions.value).toBe(false)
    expect(svc.macroCountSource.value).toBe('undefined')
  })

  it('resolves undefined → gate does NOT fire, source = undefined', async () => {
    const { default: macroMetrics } = await import('@/services/MacroMetrics')
    vi.mocked(macroMetrics.getMacroMetrics).mockResolvedValue(undefined)
    const svc = await freshService()
    await svc.initialize()
    expect(svc.shouldBlockActions.value).toBe(false)
    expect(svc.macroCountSource.value).toBe('undefined')
  })

  it('total:0 under-return → gate does NOT fire, source = zero', async () => {
    const { default: macroMetrics } = await import('@/services/MacroMetrics')
    vi.mocked(macroMetrics.getMacroMetrics).mockResolvedValue(overLimit({ total: 0, source: 'collect' }))
    const svc = await freshService()
    await svc.initialize()
    expect(svc.shouldBlockActions.value).toBe(false)
    expect(svc.macroCountSource.value).toBe('zero')
  })

  it('control — real over-limit count from KV → block stays off, source = kv', async () => {
    const { default: macroMetrics } = await import('@/services/MacroMetrics')
    vi.mocked(macroMetrics.getMacroMetrics).mockResolvedValue(overLimit({ source: 'kv' }))
    const svc = await freshService()
    await svc.initialize()
    expect(svc.macrosCreated.value).toBe(150)
    expect(svc.shouldBlockActions.value).toBe(false)
    expect(svc.macroCountSource.value).toBe('kv')
  })

  it('control — real over-limit count from fresh collect → block stays off, source = collect', async () => {
    const { default: macroMetrics } = await import('@/services/MacroMetrics')
    vi.mocked(macroMetrics.getMacroMetrics).mockResolvedValue(overLimit({ source: 'collect' }))
    const svc = await freshService()
    await svc.initialize()
    expect(svc.shouldBlockActions.value).toBe(false)
    expect(svc.macroCountSource.value).toBe('collect')
  })

  it('localStorage mock count → source = mock', async () => {
    localStorage.mockMacroCount = '150'
    const svc = await freshService()
    await svc.initialize()
    expect(svc.shouldBlockActions.value).toBe(false)
    expect(svc.macroCountSource.value).toBe('mock')
  })
})
