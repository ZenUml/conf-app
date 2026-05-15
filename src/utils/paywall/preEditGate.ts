export function isPageEditorEditBlocked(
  customContentId: string | undefined,
  shouldBlockActions: boolean
): boolean {
  return Boolean(customContentId) && shouldBlockActions;
}

export function isPageEditorCreateBlocked(shouldBlockActions: boolean): boolean {
  return shouldBlockActions;
}
