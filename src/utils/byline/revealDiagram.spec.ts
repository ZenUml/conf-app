import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  cancelReveal,
  claimReveal,
  followThisMacro,
  requestReveal,
  revealThisMacro,
  REVEAL_TTL_MS,
} from './revealDiagram'

/** Drives the observer by hand: `see(top, bottom)` is the visible slice of a 0–500px macro. */
function fakeObserver() {
  let callback: IntersectionObserverCallback | null = null
  const disconnect = vi.fn()
  class FakeIO {
    constructor(cb: IntersectionObserverCallback) { callback = cb }
    observe() {}
    disconnect = disconnect
  }
  vi.stubGlobal('IntersectionObserver', FakeIO)
  const box = { top: 0, bottom: 500, height: 500 }
  const see = (top: number | null, bottom = 500) => {
    const visible = top !== null
    const seen = visible ? { top, bottom, height: bottom - top } : { top: 0, bottom: 0, height: 0 }
    callback!([{ isIntersecting: visible, boundingClientRect: box, intersectionRect: seen } as any], {} as any)
  }
  return { see, disconnect }
}

const PAGE = 'page-1'
const CC = 'cc-2'
const NOW = Date.parse('2026-09-05T12:00:00.000Z')

describe('revealDiagram — the hand-off across the reload', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.className = ''
  })

  describe('the note', () => {
    it('is claimed by the macro it names', () => {
      requestReveal(PAGE, CC, NOW)
      expect(claimReveal(PAGE, CC, NOW + 3000)).toBe(3000)
    })

    it('is claimed once, so the same diagram twice on a page scrolls once', () => {
      requestReveal(PAGE, CC, NOW)
      expect(claimReveal(PAGE, CC, NOW)).toBe(0)
      expect(claimReveal(PAGE, CC, NOW)).toBeNull()
    })

    it('is not claimed by another diagram', () => {
      requestReveal(PAGE, CC, NOW)
      expect(claimReveal(PAGE, 'cc-999', NOW)).toBeNull()
      // …and stays claimable by the right one, which may still be rendering.
      expect(claimReveal(PAGE, CC, NOW)).toBe(0)
    })

    it('is not claimed on another page', () => {
      // Two tabs share this storage; the note has to say which page it is for.
      requestReveal(PAGE, CC, NOW)
      expect(claimReveal('page-other', CC, NOW)).toBeNull()
    })

    it('expires rather than yanking a page around later', () => {
      requestReveal(PAGE, CC, NOW)
      expect(claimReveal(PAGE, CC, NOW + REVEAL_TTL_MS + 1)).toBeNull()
    })

    it('is deleted by whoever finds it expired', () => {
      // Otherwise a reload that never rendered the macro leaves it lying in
      // wait, and a clock correction later makes it fresh again.
      requestReveal(PAGE, CC, NOW)
      claimReveal(PAGE, CC, NOW + REVEAL_TTL_MS + 1)
      expect(claimReveal(PAGE, CC, NOW + 1)).toBeNull()
    })

    it('is dropped when the reload did not happen', () => {
      requestReveal(PAGE, CC, NOW)
      cancelReveal()
      expect(claimReveal(PAGE, CC, NOW)).toBeNull()
    })

    it('claims nothing without both ids', () => {
      requestReveal(PAGE, CC, NOW)
      expect(claimReveal(undefined, CC, NOW)).toBeNull()
      expect(claimReveal(PAGE, undefined, NOW)).toBeNull()
    })

    it('ignores a malformed note rather than throwing into the macro render', () => {
      window.localStorage.setItem('zenumlRevealDiagram', '{not json')
      expect(claimReveal(PAGE, CC, NOW)).toBeNull()
    })
  })

  describe('the reveal itself', () => {
    afterEach(() => vi.useRealTimers())

    it('focuses to scroll, then leaves nothing focused behind', () => {
      // Focus is the only lever an app in a cross-origin iframe has on the host
      // page's scroll position. Leaving it parked would send the next Tab from
      // an invisible element at the top of the macro.
      const focus = vi.fn()
      const blur = vi.fn()
      const real = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = real(tag) as HTMLElement
        if (tag === 'div') {
          el.focus = focus
          el.blur = blur
        }
        return el as any
      })

      revealThisMacro()

      expect(focus).toHaveBeenCalled()
      expect(blur).toHaveBeenCalled()
      // The 1px anchor is gone; only the overlay (also aria-hidden) remains.
      expect(document.body.querySelector('[tabindex="-1"]')).toBeNull()
      vi.mocked(document.createElement).mockRestore()
    })

    it('washes the whole macro box, not just its edge, and cleans up after', () => {
      // A hairline ring on a large diagram is easy to miss after a long scroll.
      vi.useFakeTimers()
      revealThisMacro(1000)

      const overlay = document.querySelector('[data-testid="zenuml-reveal-flash"]');
      expect(overlay).not.toBeNull()
      expect(document.documentElement.classList.contains('zenuml-revealed')).toBe(true)
      expect(document.getElementById('zenuml-reveal-style')).not.toBeNull()

      vi.advanceTimersByTime(1001)
      expect(document.querySelector('[data-testid="zenuml-reveal-flash"]')).toBeNull()
      expect(document.documentElement.classList.contains('zenuml-revealed')).toBe(false)
    })

    it('never swallows a click meant for the diagram underneath', () => {
      revealThisMacro()
      const overlay = document.querySelector('[data-testid="zenuml-reveal-flash"]') as HTMLElement
      expect(overlay.getAttribute('aria-hidden')).toBe('true')
      // The style rule carries pointer-events: none; assert the contract holds
      // at the sheet, since jsdom does not compute it.
      expect(document.getElementById('zenuml-reveal-style')!.textContent)
        .toContain('pointer-events: none')
    })

    it('leaves one overlay behind when revealed twice', () => {
      revealThisMacro()
      revealThisMacro()
      expect(document.querySelectorAll('[data-testid="zenuml-reveal-flash"]')).toHaveLength(1)
    })

    it('never breaks the render when the DOM refuses', () => {
      // The diagram is on the page either way; the flourish is not worth an
      // exception on the macro's mount path.
      vi.spyOn(document.body, 'prepend').mockImplementation(() => {
        throw new Error('nope')
      })
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
      expect(() => revealThisMacro()).not.toThrow()
      debug.mockRestore()
    })
  })

  describe('keeping it in view while the rest of the page loads', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    })

    it('re-reveals when content above pushes it out through the bottom', () => {
      // whimet4, 2026-11-08: a macro above grew 416px after this one settled.
      const { see } = fakeObserver()
      const reveal = vi.fn()
      followThisMacro({ reveal })

      see(0, 500)
      see(0, 80)
      expect(reveal).toHaveBeenCalledTimes(1)
    })

    it('re-reveals when it is pushed right off the screen', () => {
      const { see } = fakeObserver()
      const reveal = vi.fn()
      followThisMacro({ reveal })

      see(0, 500)
      see(null)
      expect(reveal).toHaveBeenCalledTimes(1)
    })

    it('leaves small movements alone', () => {
      const { see } = fakeObserver()
      const reveal = vi.fn()
      followThisMacro({ reveal })

      see(0, 500)
      see(0, 480)
      expect(reveal).not.toHaveBeenCalled()
    })

    it('stops once the user scrolls down past it', () => {
      // Content above can only push the macro down. Its top leaving the screen
      // means the user scrolled, and pulling them back would fight them.
      const { see, disconnect } = fakeObserver()
      const reveal = vi.fn()
      followThisMacro({ reveal })

      see(0, 500)
      see(300, 500)
      see(null)
      expect(reveal).not.toHaveBeenCalled()
      expect(disconnect).toHaveBeenCalled()
    })

    it('stops at the first interaction with the diagram', () => {
      const { see } = fakeObserver()
      const reveal = vi.fn()
      followThisMacro({ reveal })

      see(0, 500)
      window.dispatchEvent(new Event('pointerdown'))
      see(0, 80)
      expect(reveal).not.toHaveBeenCalled()
    })

    it('gives up after a few re-reveals and after the follow window', () => {
      vi.useFakeTimers()
      const { see } = fakeObserver()
      const reveal = vi.fn()
      followThisMacro({ reveal, maxRefocus: 2 })

      for (let i = 0; i < 4; i++) { see(0, 500); see(0, 80) }
      expect(reveal).toHaveBeenCalledTimes(2)

      const second = fakeObserver()
      const late = vi.fn()
      followThisMacro({ reveal: late, followMs: 1000 })
      vi.advanceTimersByTime(1001)
      second.see(0, 500)
      second.see(0, 80)
      expect(late).not.toHaveBeenCalled()
    })

    it('does nothing where IntersectionObserver is missing', () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      expect(() => followThisMacro()()).not.toThrow()
    })
  })
})
