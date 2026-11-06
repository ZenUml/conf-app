import { resolveLocalContentId, resolveLocalTypedContentId } from '@/utils/embedDeeplink'

/**
 * Which custom content a macro node puts on the page, by either of the two ways
 * a macro can name one.
 *
 * A macro that has been SAVED carries `customContentId`. A macro created by
 * PASTING a deeplink carries `autoConvertLink` and nothing else until its first
 * save writes the binding — measured on a real page 2026-08-14, where a
 * just-published pasted macro's parameters were exactly
 * `{layout, forgeEnvironment, autoConvertLink, embeddedMacroContext,
 * extensionId, extensionTitle, hasBeenAutoConverted, render, localId}`. Reading
 * only `customContentId` therefore misses precisely the macros the byline
 * itself creates, and reports a diagram visibly on the page as not on it.
 *
 * The link is resolved through the cloudId-guarded helpers for the reason those
 * exist: content ids are per-site integers, so a link pasted from another
 * tenant would otherwise mark an unrelated local diagram as placed.
 *
 * This lives on its own rather than inside AtlasPage because two callers need
 * the same answer from different shapes: AtlasPage walks already-extracted
 * macro elements, and utils/byline/addToPage walks a raw ADF document before
 * appending to it. When those two disagreed, "is it already here?" answered no
 * for a pasted macro and the one-click place appended a second copy of a
 * diagram the page was already rendering.
 */
export function referencedCustomContentId(
  parameters: unknown,
  cloudId: string | undefined,
): string | undefined {
  const p: any = parameters || {}
  // Forge nests saved params under guestParams, Connect under macroParams —
  // but an autoConverted Forge macro has neither and puts everything at the
  // top level, so all three are candidates.
  for (const params of [p.guestParams, p.macroParams, p]) {
    if (!params) continue
    const raw = params.customContentId
    const id = typeof raw === 'string' ? raw : raw?.value
    if (id) return String(id)
    const link = params.autoConvertLink
    const fromLink = resolveLocalTypedContentId(link, cloudId) || resolveLocalContentId(link, cloudId)
    if (fromLink) return String(fromLink)
  }
  return undefined
}
