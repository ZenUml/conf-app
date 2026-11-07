import { describe, expect, it } from 'vitest'
import { fingerprintBlock, placementAt, resolveInsertIndex } from './pagePlacement'

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const A = para('a')
const B = para('b')
const C = para('c')

describe('resolveInsertIndex', () => {
  it('trusts the index while the page has not moved', () => {
    // Repeated blocks are ambiguous by content, but not on the same version.
    const blank = para('')
    const content = [blank, blank, blank]
    expect(resolveInsertIndex(content, 3, placementAt(content, 2, 3))).toBe(2)
  })

  it('keeps the end of the page the end, whatever was added', () => {
    const chosen = placementAt([A, B], 2, 3)
    expect(resolveInsertIndex([A, B, C], 4, chosen)).toBe(3)
  })

  it('keeps the start of the page the start', () => {
    const chosen = placementAt([A, B], 0, 3)
    expect(resolveInsertIndex([C, A, B], 4, chosen)).toBe(0)
  })

  it('finds the same two neighbours at their new position', () => {
    const chosen = placementAt([A, B], 1, 3)
    expect(resolveInsertIndex([C, A, B], 4, chosen)).toBe(2)
  })

  it('gives up when the neighbours are no longer adjacent', () => {
    const chosen = placementAt([A, B], 1, 3)
    expect(resolveInsertIndex([A, C, B], 4, chosen)).toBeNull()
  })

  it('gives up rather than guess between two matching spots', () => {
    const chosen = placementAt([A, B], 1, 3)
    expect(resolveInsertIndex([A, B, C, A, B], 4, chosen)).toBeNull()
  })

  it('handles an empty page', () => {
    expect(resolveInsertIndex([], 1, placementAt([], 0, 1))).toBe(0)
  })
})

describe('fingerprintBlock', () => {
  it('separates different blocks and matches equal ones', () => {
    expect(fingerprintBlock(para('a'))).toBe(fingerprintBlock(para('a')))
    expect(fingerprintBlock(para('a'))).not.toBe(fingerprintBlock(para('b')))
  })
})
