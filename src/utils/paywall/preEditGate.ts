export function isPageEditorEditBlocked(
  customContentId: string | undefined,
  shouldBlockActions: boolean
): boolean {
  return Boolean(customContentId) && shouldBlockActions;
}

export function isPageEditorCreateBlocked(shouldBlockActions: boolean): boolean {
  return shouldBlockActions;
}

export function isFullscreenViewerBlocked(
  isFullscreen: boolean,
  isEditor: boolean,
  shouldBlockActions: boolean
): boolean {
  return isFullscreen && !isEditor && shouldBlockActions;
}
