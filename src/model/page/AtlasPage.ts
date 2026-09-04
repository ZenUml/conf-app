import {AtlasDocFormat, AtlasDocElement, MacroParams, AtlasDocExtensionType, ForgeGuestParams} from "@/model/page/AtlasDocFormat";
import {trackEvent} from "@/utils/window";
import forgeGlobal from '@/model/globals/forgeGlobal';
import { forgeRequest } from "@/utils/requestUtil";
import { resolveLocalContentId, resolveLocalTypedContentId } from "@/utils/embedDeeplink";
import {LocationTarget} from "@/model/ILocationContext";

export class AtlasPage {
  async getPageId() {
    return forgeGlobal.forgeContext?.extension?.content?.id;
  }

  async getSpace() {
    return forgeGlobal.forgeContext?.extension?.space;
  }

  async getSpaceKey() {
    return forgeGlobal.forgeContext?.extension?.space?.key;
  }

  async getContentType() {
    return forgeGlobal.forgeContext?.extension?.content?.type || 'page';
  }

  async getHref() {
    return forgeGlobal.forgeContext?.extension?.location;
  }

  async getLocationTarget(): Promise<LocationTarget> {
    // CAUTION (#361): these camelCase literals do NOT match the LocationTarget
    // enum's lowercase values ('contentedit'/'contentview'), so ApWrapper2's
    // `target === LocationTarget.ContentEdit` comparison is always false on
    // the Forge path. The cast deliberately preserves that long-standing
    // behavior — changing the strings is a behavior change, tracked in #361.
    return (forgeGlobal.forgeContext?.extension?.isEditing ? 'contentEdit' : 'contentView') as unknown as LocationTarget;
  }

  /**
   * `null` means the page's ADF could not be read — distinct from `[]`, which
   * means it WAS read and holds no macros. Callers that make a safety decision
   * (the Edit dup gate: "is this customContentId shared?") must not treat an
   * unreadable page as "no duplicates found"; callers that only want a count
   * keep the historical assume-empty behaviour via `macros()` below.
   */
  private async macrosOrNull(): Promise<AtlasDocElement[] | null> {
    let responseBody = '';
    try {
      const pageId = await this.getPageId();
      if(!pageId) {
        return [];
      }

      // Note: `get-draft=true` is intentionally omitted for the Forge path.
      // The Forge iframe's requestConfluence cannot access the Confluence editor's
      // collaborative draft session, so get-draft=true always returns 404 from
      // within a Forge macro dialog. The published version is sufficient for
      // copy detection (counting macros that share the same customContentId).
      const response = await forgeRequest(`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`);
      console.debug('AtlasPage - page response', response);
      if (!response || !response.body) {
        // A response with no body is a failed read, not an empty page.
        return null;
      }
      responseBody = response.body;
      const {body: {atlas_doc_format: {value}}} = response;
      const doc = new AtlasDocFormat(value);
      return doc.getMacros();
    } catch (e: any) {
      trackEvent(e.message, 'query_macro_atlas_doc_format', 'warning');
      console.warn('Failed to query all macros on the page. Assuming no macros on this page.', { error: e?.message, responseBody });
      return null;
    }
  }

  private async macros(): Promise<AtlasDocElement[]> {
    return (await this.macrosOrNull()) ?? [];
  }

  private static count(
    elements: AtlasDocElement[],
    matcher: (mps: MacroParams | ForgeGuestParams) => boolean,
  ): number {
    return elements
      .map(c => c.attrs.extensionType === AtlasDocExtensionType.ForgeMacro ? c.attrs.parameters.guestParams : c.attrs.parameters.macroParams)
      .filter(mps => mps && matcher(mps))
      .length;
  }

  async countMacros(matcher: (mps: MacroParams | ForgeGuestParams) => boolean) {
    return AtlasPage.count(await this.macros(), matcher);
  }

  /**
   * Same count, but `undefined` when the page ADF could not be read at all —
   * so a caller can tell "scanned, found none" from "could not scan". See
   * macrosOrNull.
   */
  async countMacrosOrUnknown(
    matcher: (mps: MacroParams | ForgeGuestParams) => boolean,
  ): Promise<number | undefined> {
    const elements = await this.macrosOrNull();
    return elements === null ? undefined : AtlasPage.count(elements, matcher);
  }

  /**
   * Every customContentId referenced by a macro on this page, IN DOCUMENT ORDER,
   * from ONE ADF read.
   *
   * `countMacrosOrUnknown` answers a per-id question, but the byline asks about
   * every diagram on the page at once — N calls there would be N full-page ADF
   * GETs. It also needs the order, to list diagrams the way the page reads.
   *
   * An array rather than a Set precisely because order is the point; duplicates
   * are kept (one custom content can be referenced by several macros) so callers
   * can decide what a repeat means. `getMacros` traverses `content` depth-first,
   * so the array is in reading order.
   *
   * `undefined` (not an empty array) when the page could not be read, and the
   * distinction matters: a caller that labels unreferenced diagrams would
   * otherwise label ALL of them on a page it simply failed to scan.
   *
   * Reads the PUBLISHED ADF — the Forge iframe cannot see the editor's
   * collaborative draft (see macrosOrNull). So a macro placed but not yet
   * published looks unreferenced here, and callers must treat "unreferenced" as
   * a hint, never as proof the diagram is unused.
   */
  async referencedCustomContentIds(): Promise<string[] | undefined> {
    const elements = await this.macrosOrNull();
    if (elements === null) return undefined;
    const cloudId = forgeGlobal.forgeContext?.cloudId;
    const ids: string[] = [];
    for (const el of elements) {
      const id = AtlasPage.referencedId(el, cloudId);
      if (id) ids.push(id);
    }
    return ids;
  }

  /**
   * Which custom content this macro puts on the page, by either of the two ways
   * a macro can name one.
   *
   * A macro that has been SAVED carries `customContentId`. A macro created by
   * PASTING a deeplink carries `autoConvertLink` and nothing else until its
   * first save writes the binding — measured on a real page 2026-08-14, where a
   * just-published pasted macro's parameters were exactly
   * `{layout, forgeEnvironment, autoConvertLink, embeddedMacroContext,
   * extensionId, extensionTitle, hasBeenAutoConverted, render, localId}`. Reading
   * only `customContentId` therefore missed precisely the macros the byline
   * itself creates, and reported a diagram visibly on the page as not on it.
   *
   * The link is resolved through the cloudId-guarded helpers for the reason
   * those exist: content ids are per-site integers, so a link pasted from
   * another tenant would otherwise mark an unrelated local diagram as placed.
   */
  private static referencedId(el: AtlasDocElement, cloudId: string | undefined): string | undefined {
    const p: any = el.attrs.parameters || {};
    // Forge nests saved params under guestParams, Connect under macroParams —
    // but an autoConverted Forge macro has neither and puts everything at the
    // top level, so all three are candidates.
    for (const params of [p.guestParams, p.macroParams, p]) {
      if (!params) continue;
      const raw = params.customContentId;
      const id = typeof raw === 'string' ? raw : raw?.value;
      if (id) return String(id);
      const link = params.autoConvertLink;
      const fromLink =
        resolveLocalTypedContentId(link, cloudId) || resolveLocalContentId(link, cloudId);
      if (fromLink) return String(fromLink);
    }
    return undefined;
  }
}
