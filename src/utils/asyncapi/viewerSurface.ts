/**
 * Which surface the AsyncAPI viewer iframe renders, from the Forge modal's
 * `macroMode`.
 *
 * - `'studio-modal'`: the dashboard's "View" modal (`macroMode: 'viewer'`).
 *   The bare React viewer, with an Edit button that swaps to AsyncAPI Studio
 *   in place, because a second modal would lose the user gesture.
 * - `'macro'`: the page-rendered macro AND its Fullscreen
 *   (`macroMode: 'fullscreen'`). Both mount AsyncApiMacroViewer inside
 *   GenericViewer, like every other macro type, so Fullscreen gets the same
 *   header (Connect MCP, Diagram link, Export PNG) and the Lite fullscreen
 *   paywall. GenericViewer hides Edit in Fullscreen, so it stays read-only.
 *
 * Fullscreen used to take the dashboard path, which rendered no ZenUML header
 * at all: no Connect MCP button, and the paywall call on the macro path never
 * ran for it.
 */
export type AsyncApiViewerSurface = 'studio-modal' | 'macro';

export function asyncApiViewerSurface(macroMode: unknown): AsyncApiViewerSurface {
  return macroMode && macroMode !== 'fullscreen' ? 'studio-modal' : 'macro';
}
