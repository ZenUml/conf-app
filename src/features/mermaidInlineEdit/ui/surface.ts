/**
 * provide/inject key: Workspace.vue provides `true`, so only a Mermaid
 * renderer inside the editor's preview pane can turn inline edit on. Every
 * other mount (page viewer, Fullscreen, export, byline preview, stories
 * without Workspace) injects the default `false`. forgeIndex.ts mounts
 * Workspace whenever isEditorMode() is true: the editor modal and the native
 * macro config surface (`extension.macro.isConfiguring`); both are the editor.
 * Kept in its own file so Workspace.vue and Mermaid.vue import no feature code.
 */
export const MERMAID_INLINE_EDIT_SURFACE = 'mermaidInlineEditSurface';

/** CodeMirror publishes a UTF-16 range without changing focus or selection. */
export const MERMAID_SOURCE_SELECTION = 'mermaid-source-selection';

export interface MermaidSourceSelection {
  owner: HTMLElement;
  code: string;
  from: number;
  to: number;
  typing: boolean;
}
