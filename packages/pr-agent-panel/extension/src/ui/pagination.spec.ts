import { describe, expect, it } from 'vitest'
import { pageContaining, paginateRows } from './pagination'

describe('paginateRows', () => {
  it('packs measured row heights without clipping a row or imposing a fixed count', () => {
    const pages = paginateRows([100, 130, 90, 120, 80], 235)
    expect(pages).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 5 },
    ])
    expect(pageContaining(pages, 3)).toBe(1)
  })

  it('keeps an oversized row reachable on its own page', () => {
    expect(paginateRows([130, 80], 70)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ])
  })

  it('handles empty and unmeasured layouts', () => {
    expect(paginateRows([], 200)).toEqual([])
    expect(paginateRows([100, 100], 0)).toEqual([{ start: 0, end: 2 }])
  })
})
