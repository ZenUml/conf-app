import { describe, it, expect, beforeEach } from 'vitest'
import { PRESETS, MOCK_KEYS, applyPreset, findActivePreset } from '@/components/Debug/presets'

describe('presets', () => {
  beforeEach(() => {
    for (const k of MOCK_KEYS) localStorage.removeItem(k)
  })

  it('exposes 6 presets in stable order', () => {
    expect(PRESETS.map((p) => p.name)).toEqual([
      'Reset',
      'Lite blocked',
      'Bystander',
      'Heavy creator — Bundle primary',
      'Heavy creator — Marketplace primary',
      'Comparison view',
    ])
  })

  it('applyPreset("Bystander") writes the documented signature', () => {
    applyPreset('Bystander')
    expect(localStorage.mockCSSEnabled).toBe('true')
    expect(localStorage.mockMacroCount).toBe('120')
    expect(localStorage.mockSpacePaid).toBe('false')
    expect(localStorage.mockPersonaAwarePaywall).toBe('true')
    expect(localStorage.mockPersonalAuthored).toBe('0')
    expect(localStorage.mockTenantSizeEstimate).toBe('small_likely')
    expect(localStorage.mockConfluenceAdmin).toBe('false')
    expect(localStorage.mockNotifyAdmin).toBe('{"notified":true,"adminCount":1}')
    expect(localStorage.mockPersonaThreshold).toBeUndefined()
  })

  it('applyPreset("Reset") deletes every mock key', () => {
    localStorage.mockCSSEnabled = 'true'
    localStorage.mockMacroCount = '120'
    applyPreset('Reset')
    for (const k of MOCK_KEYS) expect(localStorage.getItem(k)).toBeNull()
  })

  it('findActivePreset returns the matching preset name', () => {
    applyPreset('Heavy creator — Bundle primary')
    expect(findActivePreset()).toBe('Heavy creator — Bundle primary')
  })

  it('findActivePreset returns null when no preset matches', () => {
    applyPreset('Bystander')
    localStorage.mockMacroCount = '999'
    expect(findActivePreset()).toBeNull()
  })

  it('applyPreset is fully replacing — leftover keys from a prior preset get cleared', () => {
    applyPreset('Bystander')
    applyPreset('Lite blocked')
    expect(localStorage.mockPersonaAwarePaywall).toBeUndefined()
    expect(localStorage.mockPersonalAuthored).toBeUndefined()
  })
})
