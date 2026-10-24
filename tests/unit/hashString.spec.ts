import { describe, it, expect } from 'vitest'
import { hashString } from '@/utils/hashString'

describe('hashString', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('A->B: hi')).toBe(hashString('A->B: hi'))
  })

  it('differs for different input', () => {
    expect(hashString('A->B: hi')).not.toBe(hashString('A->B: bye'))
  })

  it('returns a non-empty hex string for empty input', () => {
    expect(hashString('')).toMatch(/^[0-9a-f]+$/)
  })
})
