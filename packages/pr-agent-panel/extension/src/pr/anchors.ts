/**
 * Where the left review list goes on a pull-request page.
 *
 * github.com's React PR layout (2026-10) nests a `SplitPageLayout` whose
 * content row holds `SplitPageLayout.Content` (the conversation) and a pane
 * wrapper holding `#pr-conversation-sidebar`. The list is inserted as a new
 * first child of that row, before the Content node, so it sits left of the PR
 * body and never on top of GitHub's own UI.
 */
export interface LayoutAnchors {
  /** The PR body node the list sits beside. */
  contentNode: Element
  /** Insert the list immediately before this node. */
  insertBeforeNode: Element
  /** The conversation sidebar, when the page has one (evidence that this is the right layout). */
  sidebarNode: Element | null
}

const CONTENT = '[data-component="SplitPageLayout.Content"]'
const LAYOUT_EVIDENCE = '#pr-conversation-sidebar, .js-discussion'
const FALLBACK = '#repo-content-pjax-container .js-discussion'

export function findLayout(doc: Document): LayoutAnchors | null {
  try {
    for (const content of Array.from(doc.querySelectorAll(CONTENT))) {
      const parent = content.parentElement
      if (parent && parent.querySelector(LAYOUT_EVIDENCE)) {
        return {
          contentNode: content,
          insertBeforeNode: content,
          sidebarNode: parent.querySelector('#pr-conversation-sidebar'),
        }
      }
    }
    const fallback = doc.querySelector(FALLBACK)
    if (fallback) {
      return { contentNode: fallback, insertBeforeNode: fallback, sidebarNode: doc.querySelector('#pr-conversation-sidebar') }
    }
  } catch {
    // A malformed or exotic document must never break the page.
  }
  return null
}
