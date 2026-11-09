import { describe, it, expect, afterEach } from 'vitest'
import { shouldShowLicenseNotice, readMockLicenseInactive } from './licenseNotice'

const base = { productType: 'full', licenseActive: false, environmentType: 'PRODUCTION', mockInactive: false, flagEnabled: true }

describe('shouldShowLicenseNotice', () => {
  it.each([
    ['full, inactive, flag on', base, true],
    ['full, active, flag on', { ...base, licenseActive: true }, false],
    ['full, undefined', { ...base, licenseActive: undefined }, false],
    ['full, null', { ...base, licenseActive: null }, false],
    ['full, non-boolean string', { ...base, licenseActive: 'false' }, false],
    ['full, non-boolean 0', { ...base, licenseActive: 0 }, false],
    ['full, inactive, flag off', { ...base, flagEnabled: false }, false],
    ['lite', { ...base, productType: 'lite' }, false],
    ['diagramly', { ...base, productType: 'diagramly' }, false],
    ['asyncapi', { ...base, productType: 'asyncapi' }, false],
    ['unknown product', { ...base, productType: undefined }, false],
  ])('%s', (_n, input, expected) => {
    expect(shouldShowLicenseNotice(input)).toBe(expected)
  })

  it('mock override applies on staging when license is missing', () => {
    expect(shouldShowLicenseNotice({ ...base, licenseActive: undefined, environmentType: 'STAGING', mockInactive: true })).toBe(true)
  })
  it('mock override applies even when license reports active (non-production)', () => {
    expect(shouldShowLicenseNotice({ ...base, licenseActive: true, environmentType: 'development', mockInactive: true })).toBe(true)
  })
  it('mock override is never honoured in production, any case', () => {
    for (const env of ['PRODUCTION', 'production', 'Production']) {
      expect(shouldShowLicenseNotice({ ...base, licenseActive: undefined, environmentType: env, mockInactive: true })).toBe(false)
    }
  })
  it('mock override with flag off or non-full shows nothing', () => {
    expect(shouldShowLicenseNotice({ ...base, environmentType: 'STAGING', mockInactive: true, flagEnabled: false })).toBe(false)
    expect(shouldShowLicenseNotice({ ...base, productType: 'lite', environmentType: 'STAGING', mockInactive: true })).toBe(false)
  })
})

describe('readMockLicenseInactive', () => {
  afterEach(() => localStorage.clear())
  it('true only for the string "false"', () => {
    expect(readMockLicenseInactive()).toBe(false)
    localStorage.setItem('mockLicenseActive', 'false')
    expect(readMockLicenseInactive()).toBe(true)
    localStorage.setItem('mockLicenseActive', 'true')
    expect(readMockLicenseInactive()).toBe(false)
  })
  it('is false when localStorage throws', () => {
    const orig = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try { expect(readMockLicenseInactive()).toBe(false) } finally { Storage.prototype.getItem = orig }
  })
})
