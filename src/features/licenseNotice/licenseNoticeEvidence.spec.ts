import { describe, it, expect, vi } from 'vitest'
import { shouldShowLicenseNotice, licenseNoticeBasis, resolveLicenseNotice } from './licenseNotice'

const now = Date.parse('2026-11-11T09:00:00Z')
const base = { productType: 'full', licenseActive: undefined, environmentType: 'PRODUCTION', mockInactive: false, flagEnabled: true }
const evidence = { state: 'legacy_free', checkedAt: '2026-11-11T08:00:00Z', expiresAt: '2026-11-12T08:00:00Z' }

describe('license notice evidence', () => {
  it('recognizes an explicit Forge Legacy Free type without assuming missing licenses are invalid', () => {
    expect(shouldShowLicenseNotice({ ...base, licenseType: 'LEGACY_FREE' } as any)).toBe(true)
    expect(licenseNoticeBasis({ ...base, licenseType: 'LEGACY_FREE' })).toBe('forge_legacy_free')
    expect(licenseNoticeBasis(base)).toBeNull()
    expect(licenseNoticeBasis({ ...base, licenseType: 'FREE' })).toBeNull()
  })
  it('an active license wins over every Legacy Free signal in production', () => {
    expect(licenseNoticeBasis({ ...base, licenseActive: true, licenseType: 'LEGACY_FREE', marketplaceEvidence: evidence }, now)).toBeNull()
  })
  it('accepts only fresh positive backend evidence for an otherwise unknown license', () => {
    expect(licenseNoticeBasis({ ...base, marketplaceEvidence: evidence }, now)).toBe('marketplace_legacy_free')
    for (const value of [undefined, {}, { state: 'unknown' }, { ...evidence, expiresAt: '2026-11-11T09:00:00Z' }, { ...evidence, checkedAt: '2026-11-11T10:00:00Z' }, { ...evidence, expiresAt: '2026-11-15T08:00:00Z' }]) {
      expect(licenseNoticeBasis({ ...base, marketplaceEvidence: value }, now)).toBeNull()
    }
  })
  it('does not query a backend when active, explicitly inactive, disabled or non-Full', async () => {
    for (const input of [{ ...base, licenseActive: true }, { ...base, licenseActive: false }, { ...base, flagEnabled: false }, { ...base, productType: 'lite' }]) {
      const lookup = vi.fn()
      await resolveLicenseNotice(input, lookup, now)
      expect(lookup).not.toHaveBeenCalled()
    }
  })
  it('uses authenticated evidence only for the missing-license path', async () => {
    const lookup = vi.fn().mockResolvedValue(evidence)
    expect(await resolveLicenseNotice(base, lookup, now)).toEqual({ basis: 'marketplace_legacy_free', outcome: 'shown', expiresAt: evidence.expiresAt })
    expect(lookup).toHaveBeenCalledOnce()
  })
  it('a lookup failure stays unavailable and hides the notice', async () => {
    expect(await resolveLicenseNotice(base, () => Promise.reject(new Error('offline')), now)).toEqual({ basis: null, outcome: 'unavailable' })
    expect(await resolveLicenseNotice(base, () => Promise.resolve({ state: 'unknown' }), now)).toEqual({ basis: null, outcome: 'unknown' })
  })
  it('does not turn malformed license-active values into no license', async () => {
    const lookup = vi.fn()
    expect(await resolveLicenseNotice({ ...base, licenseActive: 'false' }, lookup, now)).toEqual({ basis: null, outcome: 'unknown' })
    expect(lookup).not.toHaveBeenCalled()
  })
})
