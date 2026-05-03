import { describe, it, expect, beforeEach } from 'vitest'
import { PRESETS, MOCK_KEYS, applyPreset, findActivePreset } from '@/components/Debug/presets'

describe('presets', () => {
  beforeEach(() => {
    for (const k of MOCK_KEYS) localStorage.removeItem(k)
  })

  it('Reset is always the first preset (so empty localStorage matches Reset, not nothing)', () => {
    expect(PRESETS[0].name).toBe('Reset')
  })

  it('applyPreset("Lite blocked") writes the documented signature', () => {
    applyPreset('Lite blocked')
    expect(localStorage.getItem('mockCSSEnabled')).toBe('true')
    expect(localStorage.getItem('mockMacroCount')).toBe('120')
    expect(localStorage.getItem('mockSpacePaid')).toBe('false')
  })

  it('applyPreset("Reset") deletes every mock key', () => {
    localStorage.setItem('mockCSSEnabled', 'true')
    localStorage.setItem('mockMacroCount', '120')
    applyPreset('Reset')
    for (const k of MOCK_KEYS) expect(localStorage.getItem(k)).toBeNull()
  })

  it('findActivePreset returns the matching preset name', () => {
    applyPreset('Lite blocked')
    expect(findActivePreset()).toBe('Lite blocked')
  })

  it('findActivePreset returns null when no preset matches', () => {
    applyPreset('Lite blocked')
    localStorage.setItem('mockMacroCount', '999')
    expect(findActivePreset()).toBeNull()
  })

  it('applyPreset is fully replacing — leftover keys from a prior preset get cleared', () => {
    applyPreset('Lite blocked')
    applyPreset('Reset')
    for (const k of MOCK_KEYS) expect(localStorage.getItem(k)).toBeNull()
  })
})
