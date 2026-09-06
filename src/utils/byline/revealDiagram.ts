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

/** How long the highlight runs once the page has stopped moving. */
export const REVEAL_HIGHLIGHT_MS = 2800

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

const REVEAL_STYLE_ID = 'zenuml-reveal-style'
const REVEAL_OVERLAY_CLASS = 'zenuml-reveal-flash'

/**
 * Pull the page here, then say which one moved.
 *
 * The focus target is a 1px element rather than the diagram itself because
 * focusing a real control would also ARM it — a stray Enter would then open or
 * edit the diagram the user has not looked at yet.
 *
 * The highlight is an OVERLAY, not a border on the root element. A hairline
 * ring at the edge of a large macro is easy to miss — it sits far from where
 * the eye lands after a scroll, and on a Confluence page full of blue chrome it
 * reads as part of the furniture. A tinted wash across the whole box, pulsing
 * three times, is unmissable and unambiguous about WHICH element it means.
 *
 * `position: fixed; inset: 0` is exactly the macro's box: the Forge iframe is
 * sized to its content, so the iframe's viewport and the diagram's footprint on
 * the page are the same rectangle. It paints over the diagram rather than
 * around it, which is what makes it visible on a busy one — and it is inert
 * (`pointer-events: none`, `aria-hidden`), so it never intercepts a click or
 * reaches a screen reader.
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

    if (!doc.getElementById(REVEAL_STYLE_ID)) {
      const style = doc.createElement('style')
      style.id = REVEAL_STYLE_ID
      // Three pulses, not one: a single fade is over before a user who was
      // watching the scroll has re-focused on where the page landed. Reduced
      // motion holds the wash steady instead — the colour is what identifies
      // the diagram, the blinking only draws the eye to it.
      style.textContent = `
@keyframes zenumlRevealFlash {
  0%   { opacity: 0; }
  6%   { opacity: 1; }
  28%  { opacity: 0.3; }
  44%  { opacity: 1; }
  64%  { opacity: 0.3; }
  78%  { opacity: 1; }
  100% { opacity: 0; }
}
.${REVEAL_OVERLAY_CLASS} {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  border: 4px solid #0C66E4;
  border-radius: 4px;
  background: rgba(12,102,228,0.18);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.85);
  animation: zenumlRevealFlash var(--zenuml-reveal-ms,2800ms) ease-in-out 1 both;
}
@media (prefers-reduced-motion: reduce) {
  .${REVEAL_OVERLAY_CLASS} { animation: none; opacity: 1; }
}`
      doc.head.appendChild(style)
    }

    // The class on the root is the state marker the rest of the app (and the
    // spot checks) can see; the overlay is what the user sees.
    const root = doc.documentElement
    root.style.setProperty('--zenuml-reveal-ms', `${highlightMs}ms`)
    root.classList.add('zenuml-revealed')

    doc.querySelectorAll(`.${REVEAL_OVERLAY_CLASS}`).forEach(el => el.remove())
    const overlay = doc.createElement('div')
    overlay.className = REVEAL_OVERLAY_CLASS
    overlay.setAttribute('aria-hidden', 'true')
    overlay.dataset.testid = 'zenuml-reveal-flash'
    doc.body.appendChild(overlay)

    window.setTimeout(() => {
      root.classList.remove('zenuml-revealed')
      overlay.remove()
    }, highlightMs)
  } catch (e) {
    // The diagram is on the page either way. Never let the flourish break the render.
    console.debug('[reveal] could not reveal this macro', e)
  }
}
