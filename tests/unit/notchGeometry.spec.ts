import { describe, expect, it } from 'vitest'
import { getNotchGeometry } from '@/components/Notch/notchGeometry'

describe('getNotchGeometry', () => {
  it('uses the 30px browser-tab flare without stretching it at wider widths', () => {
    const baseline = getNotchGeometry(0)
    const wide = getNotchGeometry(420)

    expect(baseline.width).toBeCloseTo(252 * 30 / 31)
    expect(wide.width).toBe(420)
    expect(wide.strokePath).toContain('C 8.4 0, 12.599999999999998 29.5, 28 29.5')
    expect(wide.strokePath).toContain('H 392')
    expect(wide.strokePath.endsWith('Z')).toBe(false)
  })

  it('uses a four-point-grid label inset', () => {
    expect(getNotchGeometry(252).inset).toBe(36)
  })
})
