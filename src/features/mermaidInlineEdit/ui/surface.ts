import type { InjectionKey } from 'vue';

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

export const reportInlineIntroRender: InjectionKey<(code: string, svg: Element | null) => void> =
  Symbol('reportMermaidInlineIntroRender');
