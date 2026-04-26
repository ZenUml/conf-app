export const MOCK_KEYS = [
  'mockCSSEnabled',
  'mockMacroCount',
  'mockSpacePaid',
  'mockPersonaAwarePaywall',
  'mockPersonalAuthored',
  'mockTenantSizeEstimate',
  'mockPersonaThreshold',
  'mockNotifyAdmin',
] as const

export type MockKey = (typeof MOCK_KEYS)[number]

/** A preset signature: keys that should be set to the given string value.
 *  Any MockKey not present in the signature is deleted from localStorage when applied. */
export type Signature = Partial<Record<MockKey, string>>

export interface Preset {
  name: string
  signature: Signature
}

export const PRESETS: Preset[] = [
  { name: 'Reset', signature: {} },
  {
    name: 'Lite blocked',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
    },
  },
  {
    name: 'Bystander',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '0',
      mockTenantSizeEstimate: 'small_likely',
      mockNotifyAdmin: '{"notified":true,"adminCount":1}',
    },
  },
  {
    name: 'Heavy creator',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '60',
      mockTenantSizeEstimate: 'medium_or_larger',
    },
  },
  {
    name: 'Comparison view',
    signature: {
      mockCSSEnabled: 'true',
      mockMacroCount: '120',
      mockSpacePaid: 'false',
      mockPersonaAwarePaywall: 'true',
      mockPersonalAuthored: '20',
      mockTenantSizeEstimate: 'unknown',
    },
  },
]

/** Write the preset's signature to localStorage and delete any MockKey not in it. */
export function applyPreset(name: string): void {
  const preset = PRESETS.find((p) => p.name === name)
  if (!preset) throw new Error(`Unknown preset: ${name}`)
  for (const k of MOCK_KEYS) {
    const v = preset.signature[k]
    if (v === undefined) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  }
}

/** Return the name of the first preset whose signature exactly matches current localStorage,
 *  or null if no preset matches. */
export function findActivePreset(): string | null {
  for (const preset of PRESETS) {
    let matches = true
    for (const k of MOCK_KEYS) {
      const stored = localStorage.getItem(k)
      const expected = preset.signature[k] ?? null
      if (stored !== expected) {
        matches = false
        break
      }
    }
    if (matches) return preset.name
  }
  return null
}
