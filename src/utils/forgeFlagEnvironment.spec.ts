import { describe, it, expect } from 'vitest'
import { mapEnvironment } from './forgeFlagEnvironment'

// Carried over from utils/prefetch/flags.spec.ts when mapEnvironment moved here
// (renderer-prefetch flags retired 2026-07-25). The 'weird'/undefined rows are
// the fail-closed contract: anything unrecognised must land on 'production',
// where a flag is off until explicitly configured.
describe('mapEnvironment', () => {
  it.each([
    ['DEVELOPMENT', 'development'],
    ['STAGING', 'staging'],
    ['PRODUCTION', 'production'],
    ['development', 'development'],
    ['weird', 'production'],
    [undefined, 'production'],
    [null, 'production'],
    [42, 'production'],
  ])('maps %s → %s', (input, expected) => {
    expect(mapEnvironment(input)).toBe(expected)
  })
})
