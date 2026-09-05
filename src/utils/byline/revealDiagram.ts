/**
 * Hand-off between the surface that places a diagram and the macro that then
 * renders it — across a full page reload and two iframes that cannot talk.
 *
 * "Add to page" appends the macro to the page ADF and reloads (addToPage.ts).
 * The user's reward for that click is a diagram they may never see: it is
 * appended to the END of the document, so on any page longer than a screen the
 * reloaded page opens at the top and the thing they just placed is somewhere
 * below the fold. The click looks like it did nothing.
 *
 * Nobody in this app can scroll the Confluence page. The banner and the byline
 * are sandboxed cross-origin iframes; so is every macro. What a macro CAN do is
 * take focus, and the browser then scrolls its ancestors — across the origin
 * boundary — to bring the focused element into view. Measured on lite-stg
 * 2026-09-05: a macro 4,965px below the fold, focused from inside its own
 * iframe, moved Confluence's scroll container (`div#AkMainContent`) until the
 * extension node sat 423px from the top. `scrollIntoView` does NOT do this — it
 * stops at the iframe's own document.
 *
 * So the placing surface leaves a note here, the reload happens, and the macro
 * that matches it claims the note and pulls the page to itself. localStorage is
 * the medium because every one of our iframes — banner, byline, macro — is
 * served from the same app origin, which is also why the note must name the
 * page: two tabs on two pages share this storage.
 *
 * Short-lived by design. The note is for THIS reload; a stale one would yank a
 * page around minutes later for no visible reason, so it expires (and is
 * deleted on the first read that finds it expired).
 */

const REVEAL_KEY = 'zenumlRevealDiagram'

/**
 * How long a note stays claimable. Long enough for a heavy Confluence page to
 * load and boot the macro, short enough that an abandoned one cannot surprise
 * anybody: a reload that has not produced the macro within a minute has failed
 * for some other reason, and scrolling then would be noise.
 */
export const REVEAL_TTL_MS = 60_000

/** How long the ring stays on the diagram once the page has stopped moving. */
export const REVEAL_HIGHLIGHT_MS = 2400

interface RevealNote {
  pageId: string
  customContentId: string
  at: number
}

/** Every access is best-effort: a restrictive iframe must lose the reveal, never the macro. */
function read(): RevealNote | null {
  try {
    const raw = window.localStorage?.getItem(REVEAL_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<RevealNote>
    if (typeof p.pageId !== 'string' || !p.pageId) return null
    if (typeof p.customContentId !== 'string' || !p.customContentId) return null
    if (typeof p.at !== 'number' || !Number.isFinite(p.at)) return null
    return { pageId: p.pageId, customContentId: p.customContentId, at: p.at }
  } catch {
    return null
  }
}

function clear(): void {
  try {
    window.localStorage?.removeItem(REVEAL_KEY)
  } catch {
    /* nothing to do — the TTL is the backstop */
  }
}

/**
 * Leave the note. Called by the placing surface immediately before it reloads.
 *
 * One note at a time: a second place would only ever be for the same page, and
 * the last one written is the one the user is waiting on.
 */
export function requestReveal(pageId: string, customContentId: string, now: number = Date.now()): void {
  try {
    const note: RevealNote = { pageId: String(pageId), customContentId: String(customContentId), at: now }
    window.localStorage?.setItem(REVEAL_KEY, JSON.stringify(note))
  } catch (e) {
    console.debug('[reveal] could not record the reveal', e)
  }
}

/**
 * Am I the macro that was just placed?
 *
 * Claiming DELETES the note, so exactly one macro reveals even when the same
 * diagram is on the page twice — and so a second page load does not repeat a
 * scroll the user has already seen.
 *
 * Returns the note's age when claimed, `null` otherwise.
 */
export function claimReveal(
  pageId: string | undefined,
  customContentId: string | undefined,
  now: number = Date.now(),
): number | null {
  if (!pageId || !customContentId) return null
  const note = read()
  if (!note) return null
  // Expired notes are cleared by whoever finds them, so a page that never
  // rendered the macro does not leave one lying in wait for the next load.
  if (now - note.at > REVEAL_TTL_MS || now < note.at) {
    clear()
    return null
  }
  if (note.pageId !== String(pageId) || note.customContentId !== String(customContentId)) return null
  clear()
  return now - note.at
}

/** Drop a pending note — the reload is not happening after all. */
export function cancelReveal(): void {
  clear()
}

const RING_STYLE_ID = 'zenuml-reveal-style'

/**
 * Pull the page here, then say which one moved.
 *
 * The focus target is a 1px element rather than the diagram itself because
 * focusing a real control would also ARM it — a stray Enter would then open or
 * edit the diagram the user has not looked at yet.
 *
 * The ring is drawn as an inset shadow on the root element: the iframe's box IS
 * the macro's box on the page, so an inset ring reads as a ring around the
 * diagram, and unlike an outline it cannot be clipped by the iframe edge.
 */
export function revealThisMacro(highlightMs: number = REVEAL_HIGHLIGHT_MS): void {
  try {
    const doc = window.document
    const anchor = doc.createElement('div')
    anchor.tabIndex = -1
    anchor.setAttribute('aria-hidden', 'true')
    anchor.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;outline:none;pointer-events:none'
    doc.body.prepend(anchor)
    anchor.focus()
    // Focus was only ever a means to scroll; leaving it parked on an invisible
    // element would send the next Tab from the top of the macro.
    anchor.blur()
    anchor.remove()

    if (!doc.getElementById(RING_STYLE_ID)) {
      const style = doc.createElement('style')
      style.id = RING_STYLE_ID
      // The pulse is what makes the ring read as "this one, just now" rather
      // than as a permanent border. Reduced motion keeps the ring and drops the
      // movement, which is the part that carries the meaning anyway.
      style.textContent = `
@keyframes zenumlRevealPulse {
  0%   { box-shadow: inset 0 0 0 3px rgba(12,102,228,0.9); }
  70%  { box-shadow: inset 0 0 0 3px rgba(12,102,228,0.9); }
  100% { box-shadow: inset 0 0 0 3px rgba(12,102,228,0); }
}
.zenuml-revealed { animation: zenumlRevealPulse var(--zenuml-reveal-ms,2400ms) ease-out 1; border-radius: 3px; }
@media (prefers-reduced-motion: reduce) {
  .zenuml-revealed { animation: none; box-shadow: inset 0 0 0 3px rgba(12,102,228,0.9); }
}`
      doc.head.appendChild(style)
    }
    const root = doc.documentElement
    root.style.setProperty('--zenuml-reveal-ms', `${highlightMs}ms`)
    root.classList.add('zenuml-revealed')
    window.setTimeout(() => root.classList.remove('zenuml-revealed'), highlightMs)
  } catch (e) {
    // The diagram is on the page either way. Never let the flourish break the render.
    console.debug('[reveal] could not reveal this macro', e)
  }
}
