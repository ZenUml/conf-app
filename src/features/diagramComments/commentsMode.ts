/** `extension.modal.macroMode` of the Comments modal (#1047). Kept apart from the panel so forgeIndex can dispatch on it without importing Vue components. */
export const COMMENTS_MACRO_MODE = 'comments'

export function isCommentsModalContext(forgeContext: Record<string, any>): boolean {
  return forgeContext?.extension?.modal?.macroMode === COMMENTS_MACRO_MODE
}
