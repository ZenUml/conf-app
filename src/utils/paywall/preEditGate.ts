export function isPageEditorEditBlocked(
  customContentId: string | undefined,
  shouldBlockActions: boolean
): boolean {
  return Boolean(customContentId) && shouldBlockActions;
}
