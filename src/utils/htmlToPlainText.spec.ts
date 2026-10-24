import { describe, it, expect } from 'vitest'
import { htmlToPlainText } from '@/utils/htmlToPlainText'

describe('htmlToPlainText', () => {
  it('strips tags, leaving the text content behind', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('strips a <script> block along with its content', () => {
    expect(htmlToPlainText('<p>before</p><script>alert("x")</script><p>after</p>')).toBe('before after')
  })

  it('strips a <style> block along with its content', () => {
    expect(htmlToPlainText('<p>before</p><style>.x { color: red; }</style><p>after</p>')).toBe('before after')
  })

  it('decodes the five entities: &amp; &lt; &gt; &quot; &#39;', () => {
    expect(htmlToPlainText('Fish &amp; Chips')).toBe('Fish & Chips')
    expect(htmlToPlainText('&lt;div&gt;')).toBe('<div>')
    expect(htmlToPlainText('say &quot;hi&quot;')).toBe('say "hi"')
    expect(htmlToPlainText('it&#39;s')).toBe("it's")
  })

  it('replaces &nbsp; with a space', () => {
    expect(htmlToPlainText('a&nbsp;b')).toBe('a b')
  })

  it('collapses runs of whitespace (including newlines/tabs) into a single space, and trims the ends', () => {
    expect(htmlToPlainText('  a\n\n\tb   c  ')).toBe('a b c')
  })

  it('returns an empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('')
  })

  it('returns an empty string for input that is only tags/whitespace', () => {
    expect(htmlToPlainText('<p>  </p><div></div>')).toBe('')
  })
})
