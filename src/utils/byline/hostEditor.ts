/**
 * Is the page hosting the byline already open in the Confluence editor?
 *
 * The post-create panel's job is to get a saved diagram onto the page, and its
 * call to action — "Open editor" — navigates there. A user who opened the
 * byline *from* the editor is already where that button would send them: the
 * prompt is noise, and taking it reloads the very editor they were typing in.
 *
 * Two signals, because neither alone is dependable here:
 *
 * - `extension.location`, documented for confluence:contentBylineItem as "full
 *   URL of the host page". This is the load-bearing one.
 * - `extension.isEditing`, which this codebase already reads on the macro
 *   surface (model/page/AtlasPage.ts, utils/stalenessHint/core.ts). It is NOT
 *   in the documented context for the byline module, so it is treated as a
 *   bonus signal that may simply be absent rather than something to rely on.
 *
 * Both fail to `false`, which keeps the existing "Open editor" affordance. A
 * false negative costs a redundant button; a false positive would strand a
 * viewer with no way to reach the editor, so the asymmetry decides the default.
 */

/**
 * Confluence editor URLs put a numeric content id straight after the edit
 * segment: `/wiki/spaces/<KEY>/pages/edit-v2/<id>`. Requiring those digits is
 * what separates it from a *view* URL whose last segment is the page title —
 * `/wiki/spaces/<KEY>/pages/<id>/edit` is a page someone titled "edit", not an
 * editor.
 */
const EDITOR_PATH_RE = /\/edit(-v2)?\/\d+/;

export function isEditorUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    // Compare on the path only: a query or fragment could carry the literal
    // "/edit-v2/123" (e.g. a return-to URL) without this being an editor.
    return EDITOR_PATH_RE.test(new URL(url).pathname);
  } catch {
    // Not absolute — `location` is documented as a full URL, but degrade to a
    // substring test rather than throwing inside a render path.
    return EDITOR_PATH_RE.test(url);
  }
}

export function isHostPageInEditor(context: any): boolean {
  const ext = context?.extension;
  if (!ext) return false;
  if (ext.isEditing === true) return true;
  return isEditorUrl(ext.location);
}
