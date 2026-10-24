import { resolveLocalTypedContentId } from '@/utils/embedDeeplink'
import { readAutoConvertLink } from '@/utils/newDiagramLink'

/**
 * The custom content a macro should load, from every place the id can live.
 *
 * Three sources, in precedence order:
 *
 * 1. `extension.config.customContentId` — an ordinary saved macro.
 * 2. `extension.modal.customContentId` — a modal opened from a non-macro
 *    surface (dashboard View, the byline's diagram cards).
 * 3. A pasted typed deeplink (`.../d/<type>/<cloudId>/<contentId>`). A macro
 *    created by autoConvert has no config at all; the id is only in the matched
 *    URL, which Confluence persists in the page ADF, so this keeps resolving on
 *    every later render with no config write.
 *
 * Shared because it was NOT shared, and that is exactly how it broke: the
 * fallback was added to forgeIndex and the embed viewer, but graph and openapi
 * have their own entry files that read `config.customContentId` directly. A
 * pasted graph link therefore produced a macro with no id — an empty canvas
 * that stayed empty after editing, because the editor treated it as a brand-new
 * diagram rather than the one the link pointed at.
 */
export function resolveEffectiveCustomContentId(context: any): string | undefined {
  return (
    context?.extension?.config?.customContentId ||
    context?.extension?.modal?.customContentId ||
    resolveLocalTypedContentId(readAutoConvertLink(context), context?.cloudId) ||
    undefined
  )
}
