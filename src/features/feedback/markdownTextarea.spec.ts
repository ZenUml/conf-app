import { describe, expect, it } from 'vitest'

import { continueMarkdownList } from './markdownTextarea'

describe('continueMarkdownList', () => {
  it('continues a bullet using literal plain text', () => {
    expect(continueMarkdownList('- First item', 12, 12)).toEqual({ value: '- First item\n- ', cursor: 15 })
  })

  it('increments a numbered item while preserving its indentation', () => {
    expect(continueMarkdownList('  9. Ninth item', 15, 15)).toEqual({ value: '  9. Ninth item\n  10. ', cursor: 22 })
  })

  it('exits a list when the current item is empty', () => {
    expect(continueMarkdownList('- First\n- ', 10, 10)).toEqual({ value: '- First\n', cursor: 8 })
  })

  it('does not intercept an ordinary line or a text selection', () => {
    expect(continueMarkdownList('Ordinary text', 13, 13)).toBeNull()
    expect(continueMarkdownList('- selected', 2, 8)).toBeNull()
  })
})
