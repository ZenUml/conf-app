import { afterEach, describe, expect, it } from 'vitest'
import { CONTENT_SHIFT_STYLE_ID, LIST_COLUMN_WIDTH, installContentShift, listColumnTop } from './page-column'

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-zenuml-pr-list')
})

describe('listColumnTop', () => {
  it('starts the column at the bottom edge of the repository tabs', () => {
    document.body.innerHTML = '<nav aria-label="Repository"></nav><turbo-frame id="repo-content-turbo-frame"></turbo-frame>'
    document.querySelector('nav')!.getBoundingClientRect = () => rect(124, 172)
    expect(listColumnTop(document)).toBe(172)
  })

  it('pins to the top of the window once the tabs have scrolled away', () => {
    document.body.innerHTML = '<nav aria-label="Repository"></nav>'
    document.querySelector('nav')!.getBoundingClientRect = () => rect(-300, -252)
    expect(listColumnTop(document)).toBe(0)
  })

  it('falls back to the top of the repository content frame', () => {
    document.body.innerHTML = '<turbo-frame id="repo-content-turbo-frame"></turbo-frame>'
    document.getElementById('repo-content-turbo-frame')!.getBoundingClientRect = () => rect(196, 900)
    expect(listColumnTop(document)).toBe(196)
  })

  it('uses 0 when neither landmark exists', () => {
    expect(listColumnTop(document)).toBe(0)
  })
})

describe('installContentShift', () => {
  it('pads the repository content by the column width below 1920 px and undoes it on cleanup', () => {
    const cleanup = installContentShift(document)
    const style = document.getElementById(CONTENT_SHIFT_STYLE_ID)
    expect(style?.textContent).toContain('#repo-content-turbo-frame')
    expect(style?.textContent).toContain(`padding-left: ${LIST_COLUMN_WIDTH}px`)
    expect(style?.textContent).toContain('max-width: 1919.98px')
    expect(document.documentElement.hasAttribute('data-zenuml-pr-list')).toBe(true)

    cleanup()
    expect(document.getElementById(CONTENT_SHIFT_STYLE_ID)).toBeNull()
    expect(document.documentElement.hasAttribute('data-zenuml-pr-list')).toBe(false)
  })

  it('installs one stylesheet even when called twice', () => {
    installContentShift(document)
    installContentShift(document)
    expect(document.querySelectorAll(`#${CONTENT_SHIFT_STYLE_ID}`)).toHaveLength(1)
  })
})
