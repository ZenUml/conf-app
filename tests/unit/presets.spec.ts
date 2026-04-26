import { describe, it, expect, beforeEach } from 'vitest'
import { PRESETS, MOCK_KEYS, applyPreset, findActivePreset } from '@/components/Debug/presets'

describe('presets', () => {
  beforeEach(() => {
    for (const k of MOCK_KEYS) localStorage.removeItem(k)
  })

  it('Reset is always the first preset (so empty localStorage matches Reset, not nothing)', () => {
    expect(PRESETS[0].name).toBe('Reset')
  })

  it('applyPreset("Bystander") writes the documented signature', () => {
    applyPreset('Bystander')
    expect(localStorage.getItem('mockCSSEnabled')).toBe('true')
    expect(localStorage.getItem('mockMacroCount')).toBe('120')
    expect(localStorage.getItem('mockSpacePaid')).toBe('false')
    expect(localStorage.getItem('mockPersonaAwarePaywall')).toBe('true')
    expect(localStorage.getItem('mockPersonalAuthored')).toBe('0')
    expect(localStorage.getItem('mockTenantSizeEstimate')).toBe('small_likely')
    expect(localStorage.getItem('mockConfluenceAdmin')).toBe('false')
    expect(localStorage.getItem('mockNotifyAdmin')).toBe('{"notified":true,"adminCount":1}')
    expect(localStorage.getItem('mockPersonaThreshold')).toBeNull()
  })

  it('applyPreset("Reset") deletes every mock key', () => {
    localStorage.setItem('mockCSSEnabled', 'true')
    localStorage.setItem('mockMacroCount', '120')
    applyPreset('Reset')
    for (const k of MOCK_KEYS) expect(localStorage.getItem(k)).toBeNull()
  })

  it('findActivePreset returns the matching preset name', () => {
    applyPreset('Heavy creator — Bundle primary')
    expect(findActivePreset()).toBe('Heavy creator — Bundle primary')
  })

  it('findActivePreset returns null when no preset matches', () => {
    applyPreset('Bystander')
    localStorage.setItem('mockMacroCount', '999')
    expect(findActivePreset()).toBeNull()
  })

  it('applyPreset is fully replacing — leftover keys from a prior preset get cleared', () => {
    applyPreset('Bystander')
    applyPreset('Lite blocked')
    expect(localStorage.getItem('mockPersonaAwarePaywall')).toBeNull()
    expect(localStorage.getItem('mockPersonalAuthored')).toBeNull()
  })
})
