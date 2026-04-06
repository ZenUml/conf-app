import {AtlasDocFormat, AtlasDocElement, MacroParams, AtlasDocExtensionType, ForgeGuestParams} from "@/model/page/AtlasDocFormat";
import {trackEvent} from "@/utils/window";
import forgeGlobal from '@/model/globals/forgeGlobal';
import { forgeRequest } from "@/utils/requestUtil";

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

  async getLocationTarget() {
    return forgeGlobal.forgeContext?.extension?.isEditing ? 'contentEdit' : 'contentView';
  }

  private async macros(): Promise<AtlasDocElement[]> {
    let responseBody = '';
    try {
      const pageId = await this.getPageId();
      if(!pageId) {
        return [];
      }

      const response = await forgeRequest(`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format&get-draft=true`);
      console.debug('AtlasPage - page response', response);
      if (!response || !response.body) {
        return [];
      }
      responseBody = response.body;
      const {body: {atlas_doc_format: {value}}} = response;
      const doc = new AtlasDocFormat(value);
      return doc.getMacros();
    } catch (e: any) {
      trackEvent(e.message, 'query_macro_atlas_doc_format', 'warning');
      console.trace('Failed to query all macros on the page. Assume there is no macros on this page.')
      console.error('This message will be very helpful for the vendor to improve their product.');
      console.error('Please consider sharing it with the vendor so that they can fix the issue.');
      console.error('Please remove all sensitive data before sharing.');
      console.error('==========');
      console.error(responseBody);
      console.error('==========');
      return [];
    }
  }

  async countMacros(matcher: (mps: MacroParams | ForgeGuestParams) => boolean) {
    return (await this.macros())
      .map(c => c.attrs.extensionType === AtlasDocExtensionType.ForgeMacro ? c.attrs.parameters.guestParams : c.attrs.parameters.macroParams)
      .filter(mps => mps && matcher(mps))
      .length;
  }
}
