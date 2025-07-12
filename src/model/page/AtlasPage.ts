import {IAp} from "@/model/IAp";
import ApWrapper2 from "@/model/ApWrapper2";
import {ILocationContext, IContext} from "@/model/ILocationContext";
import {AtlasDocFormat, AtlasDocElement, MacroParams, AtlasDocExtensionType, ForgeGuestParams} from "@/model/page/AtlasDocFormat";
import {trackEvent} from "@/utils/window";

export class AtlasPage {
  _requestFn?: (req: IApRequest) => any;
  private _locationContext?: ILocationContext;
  private _apContext?: IContext;
  private readonly _navigator: any;
  private readonly _context: any;
  private readonly _apWrapper: ApWrapper2;

  constructor(ap?: IAp, apWrapper?: ApWrapper2) {
    // TODO: why? Assigning _ap causes DOMException:
    // Blocked a frame with origin "xxx" from accessing a cross-origin frame.
    // this._ap = ap;
    this._requestFn = ap?.request;
    this._navigator = ap?.navigator;
    this._context = ap?.context;
    this._apWrapper = apWrapper || new ApWrapper2(ap as IAp);
  }

  // This method cannot be private or protected because it needs to be overwritten in test.
  async _getLocationContext(): Promise<ILocationContext> {
    if(this._locationContext) {
      return this._locationContext;
    }

    const self = this;
    return new Promise((resolve) => {
      self._navigator.getLocation((data: any) => {
        self._locationContext = Object.assign({}, data.context, {href: data.href}, {target: data.target}) as ILocationContext;
        resolve(self._locationContext);
      });
    });
  }
  
  _getContext(): Promise<IContext> {
    if(this._apContext) {
      return Promise.resolve(this._apContext);
    }

    const self = this;
    return new Promise((resolve) => {
      self._context.getContext((data: any) => {
        self._apContext = data as IContext;
        resolve(self._apContext);
      });
    });
  }

  async getPageId() {
    return this._apWrapper.isForge ? this._apWrapper.forgeContext.extension.content.id : (await this._getLocationContext()).contentId;
  }

  async getSpaceKey() {
    //there is no location context in custom content list page, but context.
    return (await this._getLocationContext()).spaceKey || ((await this._getContext()).confluence.space.key);
  }

  async getSpace() {
    //context is also available in macro editor as checked on 15 May 2025
    return (await this._getContext()).confluence?.space;
  }

  async getContentType() {
    // WARN: locationContext.contentType is undefined when creating a new page, but context.confluence?.content?.type is "page"
    return (await this._getLocationContext()).contentType || (await this._getContext()).confluence?.content?.type;
  }

  async getHref() {
    return (await this._getLocationContext()).href;
  }

  async getLocationTarget() {
    return (await this._getLocationContext()).target;
  }

  // This API may return stale data. The most recent macro may not be returned.
  // This is caused by the REST API we are calling.
  // It seems reliable enough for us to use, as we only need to know the macros
  // when we edit the newly added macro.
  private async macros(): Promise<AtlasDocElement[]> {
    if (!this._requestFn && !this._apWrapper.isForge) {
      return [];
    }
    let responseStatus = '';
    let responseBody = '';
    try {
      const pageId = await this.getPageId();
      if(!pageId) {
        return [];
      }

      const response = this._apWrapper.isForge ? await this._apWrapper.forgeRequest(`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format&get-draft=true`) : (JSON.parse(await this._requestFn?.({
        url: `/rest/api/v2/pages/${pageId}?body-format=atlas_doc_format&get-draft=true`,
        type: 'GET',
        contentType: 'application/json'
      }))).body;
      console.log('response', response);
      responseStatus = response?.xhr?.status || '';
      if (!response || !response.body) {
        return [];
      }
      responseBody = response.body;
      const {body: {atlas_doc_format: {value}}} = response;
      const doc = new AtlasDocFormat(value, this._apWrapper);
      return doc.getMacros();
    } catch (e: any) {
      trackEvent(responseStatus, 'query_macro_atlas_doc_format', 'warning');
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