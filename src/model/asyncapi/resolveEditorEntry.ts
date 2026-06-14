// Decides which editor the asyncapi variant opens when an editable surface
// mounts for an AsyncAPI macro.
//
// Two editors exist:
//   - 'embed-picker'  (forge-asyncapi-embed-editor): the document picker for
//     the zenuml-asyncapi-embed-macro. Its ONLY persistence is
//     view.submit({ config: { customContentId } }) — it rewrites which
//     document the embed references, which is a macro-config/param change.
//   - 'spec-editor'   (forge-asyncapi-editor): the Studio spec editor. It
//     saves document *content* server-side via saveToPlatform and degrades
//     gracefully when view.submit() is unavailable.
//
// The bug this guards against: changing a macro's config is only possible
// where view.submit() is submittable — the native page-editor config gesture
// (macro.isInserting / macro.isConfiguring). The view-mode "Edit" affordance
// opens a Forge *modal* (modal.macroMode === 'editor') where view.submit()
// throws "this resource's view is not submittable". Routing the embed picker
// there made re-targeting impossible: every "Embed" click hit the throw and
// surfaced "Failed to embed document. Please try again." with no way to save.
//
// Fix: the embed picker only opens from the native page-editor config surface.
// From the view-mode Edit modal we instead open the spec editor on the
// *referenced* document (editing the embed's underlying content, which the
// live reference then reflects). Re-targeting which document is embedded stays
// a page-editor operation.

export type AsyncApiEditorEntry = 'embed-picker' | 'spec-editor'

export interface AsyncApiEditorEntryInput {
  /** moduleKey is the zenuml-asyncapi-embed-macro (a document reference). */
  isEmbedMacro: boolean
  /**
   * True when mounted inside the view-mode "Edit" modal opened from the
   * viewer chrome (Forge openModal with context.macroMode === 'editor').
   * In that surface view.submit() is NOT submittable.
   */
  isViewModeEditModal: boolean
}

export function resolveAsyncApiEditorEntry({
  isEmbedMacro,
  isViewModeEditModal,
}: AsyncApiEditorEntryInput): AsyncApiEditorEntry {
  // The picker is only safe in the native page-editor config surface, where
  // view.submit() can persist the new document reference. Everywhere else
  // (notably the view-mode Edit modal) editing an embed edits its referenced
  // document's spec instead.
  if (isEmbedMacro && !isViewModeEditModal) return 'embed-picker'
  return 'spec-editor'
}
