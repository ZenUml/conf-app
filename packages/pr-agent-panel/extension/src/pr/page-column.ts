/**
 * Page-level placement of the left review list, matching Figma frames 184:5402 /
 * 184:5446: a 320 px column at the far left of the page that starts directly
 * under the repository tabs and runs to the bottom of the window. GitHub's own
 * header and tabs stay full width; only the repository content below them moves.
 *
 * github.com centres the PR in a 1280 px container, so at 1920 px and wider the
 * page's left gutter already holds the column (the PR title lands at x 352, as
 * in Figma) and nothing moves. Narrower windows pad the content frame by the
 * column width so the list never covers GitHub UI.
 */
export const LIST_COLUMN_WIDTH = 320
export const CONTENT_SHIFT_STYLE_ID = 'zenuml-pr-list-content-shift'

const REPO_TABS = 'nav[aria-label="Repository"], nav.js-repo-nav'
const CONTENT_FRAME = '#repo-content-turbo-frame'
const MARKER = 'data-zenuml-pr-list'

/** Viewport y where the column starts: under the repository tabs, or 0 once they scroll away. */
export function listColumnTop(doc: Document): number {
  const tabs = doc.querySelector(REPO_TABS)
  if (tabs) return Math.max(0, Math.round(tabs.getBoundingClientRect().bottom))
  const frame = doc.querySelector(CONTENT_FRAME)
  if (frame) return Math.max(0, Math.round(frame.getBoundingClientRect().top))
  return 0
}

/** Pads the repository content right of the column while the list is shown. Returns the undo. */
export function installContentShift(doc: Document): () => void {
  if (!doc.getElementById(CONTENT_SHIFT_STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = CONTENT_SHIFT_STYLE_ID
    style.textContent = `@media (max-width: 1919.98px) {
  html[${MARKER}] ${CONTENT_FRAME} { padding-left: ${LIST_COLUMN_WIDTH}px; box-sizing: border-box; }
}`
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }
  doc.documentElement.setAttribute(MARKER, '')
  return () => {
    doc.documentElement.removeAttribute(MARKER)
    doc.getElementById(CONTENT_SHIFT_STYLE_ID)?.remove()
  }
}
