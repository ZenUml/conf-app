/** `macroMode` of the Forge modal that previews a title draft. */
export const TITLE_DRAFT_MACRO_MODE = 'title-draft'

/** Reported through `view.close(payload)` to the page banner that opened the modal. */
export type TitleDraftClosePayload =
  | { outcome: 'added'; contentId: string }
  | { outcome: 'already_added' }
  | { outcome: 'dismissed' }

export interface TitleDraftModalContext {
  macroMode: typeof TITLE_DRAFT_MACRO_MODE
  pageId: string
  pageTitle: string
  mermaid: string
  kind?: string
  confidence?: number
}
