import {getUrlParam, trackEvent, addonKey} from '@/utils/window';
import time from '@/utils/timer';
import {IApWrapper, VersionType} from "@/model/IApWrapper";
import {IMacroData} from "@/model/IMacroData";
import {IContentProperty} from "@/model/IContentProperty";
import {ICustomContent, ICustomContentV2, SearchResults, User} from "@/model/ICustomContent";
import {IUser} from "@/model/IUser";
import {IConfluence} from "@/model/IConfluence";
import {ILicense} from "@/model/ILicense";
import {IAp} from "@/model/IAp";
import {DataSource, Diagram, DiagramType} from "@/model/Diagram/Diagram";
import {
  AccountUser,
  ICustomContentResponseBody,
  ICustomContentResponseBodyV2
} from "@/model/ICustomContentResponseBody";
import {AtlasPage} from "@/model/page/AtlasPage";
import CheckPermission, {PermissionCheckRequestFunc} from "@/model/page/CheckPermission";
import {ISpace, LocationTarget} from './ILocationContext';
import {Attachment} from './ConfluenceTypes';
import { loadAllPaginatedData } from '@/utils/requestUtil';
import forgeGlobal from '@/model/globals/forgeGlobal';
import {forgeRequest, connectRequest} from '@/utils/requestUtil';

const CUSTOM_CONTENT_TYPES = ['zenuml-content-sequence', 'zenuml-content-graph'];
const SEARCH_CUSTOM_CONTENT_LIMIT: number = 1000;

export default class ApWrapper2 implements IApWrapper {
  versionType: VersionType;
  _confluence: IConfluence;
  _requestFn: {
    (req: IApRequest): any
  };
  _navigator: any;
  _context: any;
  _dialog: any;
  _user: any;
  _page: AtlasPage;
  currentUser: IUser | undefined;
  currentSpace: ISpace | undefined;
  currentPageId: string | undefined;
  currentPageUrl: string | undefined;
  baseUrl: string | undefined;
  locationTarget: LocationTarget | undefined;
  license: ILicense | undefined;

  constructor(ap: IAp) {
    this.versionType = this.isLite() ? VersionType.Lite : VersionType.Full;
    this._confluence = ap.confluence;
    this._requestFn = ap.request;
    this._navigator = ap.navigator;
    this._context = ap.context;
    this._dialog = ap.dialog;
    this._user = ap.user;
    this._page = new AtlasPage(ap);
  }

  async initializeContext(): Promise<void> {
    try {
      this.currentUser = await this._getCurrentUser();
      this.currentSpace = await this.getCurrentSpace();
      this.currentPageUrl = await this._getCurrentPageUrl();
      this.baseUrl = await this._getBaseUrl();
      this.locationTarget = await this._getLocationTarget();
      this.currentPageId = forgeGlobal.isForge ? forgeGlobal.forgeContext.extension.content?.id : await this._page.getPageId();
      if (this.versionType === VersionType.Full) {
        this.license = forgeGlobal.isForge ? forgeGlobal.forgeContext.license : await this._getLicense();
      }
      console.log('initializeContext', this.currentUser, this.currentSpace, this.currentPageUrl, this.locationTarget, this.currentPageId, this.license);

      if (window) {
        //@ts-ignore
        window.initialContext = {
          currentUser: this.currentUser,
          currentSpace: this.currentSpace,
          currentPageUrl: this.currentPageUrl,
          currentPageId: this.currentPageId,
          locationTarget: this.locationTarget
        };
      }
    } catch (e: any) {
      console.error(e);
      try {
        trackEvent('error', 'initializeContext', e.message);
      } catch (e) {
        console.error(e);
      }
    }
  }

  getMacroData(): Promise<IMacroData | undefined> {
    return new Promise(((resolve) => {
      try {
        if (forgeGlobal.isForge) {
          //Migrated macro: extension.config?.uuid, New macro: localId
          resolve({uuid: forgeGlobal.forgeContext.extension.config?.uuid || forgeGlobal.forgeContext.localId, 
            customContentId: forgeGlobal.forgeContext.extension.config?.customContentId, 
            updatedAt: forgeGlobal.forgeContext.extension.config?.updatedAt} as IMacroData);
        } else {
          this._confluence.getMacroData((data) => {
            console.debug('Loaded macro data', data);
            resolve(data)
          });
        }
      } catch (e) {
        // eslint-disable-next-line
        console.error('Failed to retrieve macro data.', e)
        resolve(undefined)
      }
    }))
  }

  getMacroBody(): Promise<string | undefined> {
    return new Promise((resolve) => {
      try {
        this._confluence.getMacroBody((body) => {
          resolve(body)
        })
      } catch (e) {
        // eslint-disable-next-line
        console.error('Failed to retrieve macro body.', e)
        resolve(undefined)
      }
    })
  }

  getContentProperty(key: any): Promise<IContentProperty | undefined> {
    return new Promise(resolve => {
      try {
        this._confluence.getContentProperty(key, (cp) => {
          resolve(cp)
        })
      } catch (e) {
        // eslint-disable-next-line
        console.error('Failed to retrieve content property.', e)
        resolve(undefined)
      }
    })
  }

  saveMacro(params: IMacroData, body: string) {
    this._confluence.saveMacro(params, body)
  }

  // All document types will be using the same content key.
  // Old documents that uses the old content key will not be migrated.
  // We may migrate them in the future.
  getContentKey() {
    return 'zenuml-content-sequence';
  }

  getCustomContentTypePrefix() {
    const addonKey = forgeGlobal.isForge ? `com.zenuml.confluence-addon${forgeGlobal.isLite ? '-lite' : ''}` : getUrlParam('addonKey');
    console.debug('getCustomContentTypePrefix', addonKey);
    return `ac:${addonKey}`;
  }

  getCustomContentType() {
    return `${this.getCustomContentTypePrefix()}:${this.getContentKey()}`;
  }

  customContentType(type: string) {
    return `${this.getCustomContentTypePrefix()}:${type}`;
  }

  async createCustomContent(content: Diagram) {
    const type = this.getCustomContentType();
    const bodyData: any = {
      "type": type,
      "title": content.title || `Untitled ${new Date().toISOString()}`,
      "space": {
        "key": (await this.getCurrentSpace()).key
      },
      "body": {
        "raw": {
          "value": JSON.stringify(content),
          "representation": "raw"
        }
      }
    };
    const container = {id: await this._page.getPageId(), type: await this._page.getContentType()};
    if (container.id) {
      bodyData.container = container;
    }

    const response = await this.makeRequest('/rest/api/content', 'POST', bodyData);
    return response as ICustomContentResponseBody;
  }

  async createCustomContentV2(content: Diagram): Promise<ICustomContentResponseBodyV2> {
    const type = this.getCustomContentType();
    const data: any = {
      "type": type,
      "pageId": await this._getCurrentPageId(),
      "title": content.title || `Untitled ${new Date().toISOString()}`,
      "body": {
        "value": JSON.stringify(content),
        "representation": "raw"
      }
    };

    const response = await this.makeRequest('/api/v2/custom-content', 'POST', data);
    return response as ICustomContentResponseBodyV2;
  }

  async updateCustomContent(contentObj: ICustomContent, newBody: Diagram) {
    let newVersionNumber = 1;

    if (contentObj.version?.number) {
      newVersionNumber += contentObj.version?.number
    }
    const bodyData = {
      "type": contentObj.type,
      "title": newBody.title || contentObj.title,
      "space": {
        "key": contentObj.space.key
      },
      "container": contentObj.container,
      "body": {
        "raw": {
          "value": JSON.stringify(newBody),
          "representation": "raw"
        }
      },
      "version": {
        "number": newVersionNumber
      }
    };

    const response = await this.makeRequest(`/rest/api/content/${contentObj.id}`, 'PUT', bodyData);
    return response as ICustomContentResponseBody;
  }

  async updateCustomContentV2(content: ICustomContentV2, newBody: Diagram): Promise<ICustomContentResponseBodyV2> {
    let newVersionNumber = 1;

    if (content.version?.number) {
      newVersionNumber += content.version?.number
    }
    // Must provide at most one of [spaceId, pageId, blogPostId, or customContentId]
    const data = {
      "id": content.id,
      "type": content.type,
      "status": content.status,
      "pageId": content.pageId,
      "title": newBody.title || content.title,
      "body": {
        "value": JSON.stringify(newBody),
        "representation": "raw"
      },
      "version": {
        "number": newVersionNumber
      }
    };

    try {
      const response = await this.makeRequest(`/api/v2/custom-content/${content.id}`, 'PUT', data);
      trackEvent(JSON.stringify(content.id), 'update_custom_content', 'info');
      return response as ICustomContentResponseBodyV2;
    } catch (error) {
      trackEvent(JSON.stringify(error), 'update_custom_content_error', 'error');
      throw error;
    }
  }

  async getCustomContentById(id: string): Promise<ICustomContent | undefined> {
    const customContent = await this.getCustomContentRaw(id);
    if (!customContent) {
      throw Error(`Failed to load custom content by id ${id}`);
    }
    let diagram = JSON.parse(customContent.body.raw.value);
    diagram.source = DataSource.CustomContent;
    const count = (await this._page.countMacros((m) => {
      //TODO: filter by macro type
      return m?.customContentId?.value === id;
    }));
    console.debug(`Found ${count} macros on page`);

    const pageId = await this._page.getPageId();
    let isCrossPageCopy = pageId && String(pageId) !== String(customContent?.container?.id);
    if (isCrossPageCopy || count > 1) {
      diagram.isCopy = true;
      console.warn(`Detected copied macro - ID: ${id}, Cross-page copy: ${isCrossPageCopy}, Instances on page: ${count}, Source page: ${customContent?.container?.id}, Current page: ${pageId}`);
      if (isCrossPageCopy) {
        trackEvent('cross_page', 'duplication_detect', 'warning');
      }
      if (count > 1) {
        trackEvent('same_page', 'duplication_detect', 'warning');
      }
    } else {
      diagram.isCopy = false;
    }
    diagram.id = id;
    let assign = <unknown>Object.assign({}, customContent, {value: diagram});
    return <ICustomContent>assign;
  }

  async getCustomContentByIdV2(id: string): Promise<ICustomContentV2 | undefined> {
    const customContent = await this.makeRequest(`/api/v2/custom-content/${id}?body-format=raw`);
    if (!customContent) {
      throw Error(`Failed to load custom content by id ${id}`);
    }
    //@ts-ignore
    let diagram = JSON.parse(customContent.body.raw.value);
    diagram.source = DataSource.CustomContent;
    const count = (await this._page.countMacros((m) => {
      //TODO: filter by macro type
      return m?.customContentId?.value === id;
    }));
    console.debug(`Found ${count} macros on page`);

    const pageId = await this._page.getPageId();
    let isCrossPageCopy = pageId && pageId !== String(customContent?.pageId);
    if (isCrossPageCopy || count > 1) {
      diagram.isCopy = true;
      console.warn(`Detected copied macro - ID: ${id}, Cross-page copy: ${isCrossPageCopy}, Instances on page: ${count}, Source page: ${customContent?.pageId}, Current page: ${pageId}`);
      if (isCrossPageCopy) {
        trackEvent('cross_page', 'duplication_detect', 'warning');
      }
      if (count > 1) {
        trackEvent('same_page', 'duplication_detect', 'warning');
      }
    } else {
      diagram.isCopy = false;
    }
    diagram.id = id;
    let assign = <unknown>Object.assign({}, customContent, {value: diagram});
    return <ICustomContentV2>assign;
  }

  async getCustomContentVersionBeforeDate(id: string, date: string): Promise<ICustomContentV2 | undefined> {
    const customContent = await this.getCustomContentRawV2(id, 'include-versions=true');
    const descendingVersions = customContent?.versions?.results.sort((a, b) => b.number - a.number);
    const version = descendingVersions?.find(v => new Date(v.createdAt) < new Date(date)) || descendingVersions?.[descendingVersions.length - 1];
    console.log(`Found version ${version?.number} created at ${version?.createdAt} before date ${date}`);

    const customContentVersion = await this.getCustomContentRawV2(id, `version=${version?.number}&body-format=raw`);
    let diagram = JSON.parse(customContentVersion?.body?.raw?.value || '{}');
    diagram.source = DataSource.CustomContent;
    diagram.id = id;
    let assign = <unknown>Object.assign({}, customContent, {value: diagram});
    return <ICustomContentV2>assign;
  }

  async getCustomContentForCurrentPage(customContentId: string): Promise<ICustomContentV2 | undefined> {
    const pageId = await this._getCurrentPageId();
    
    //No pageId in the dashboard page
    if(pageId) {
      const page = await this.request(`/api/v2/pages/${pageId}`);

      if(page.status === 'historical') {
        const pageVersionCreatedAt = page.version.createdAt;
        trackEvent(`page created at ${pageVersionCreatedAt}`, 'view_historical_page', 'macro');
        
        return await this.getCustomContentVersionBeforeDate(customContentId, pageVersionCreatedAt);
      }
    }

    return await this.getCustomContentByIdV2(customContentId);
  }

  private async getCustomContentRaw(id: string): Promise<ICustomContentResponseBody | undefined> {
    const url = `/rest/api/content/${id}?expand=body.raw,version.number,container,space`;
    try {
      const response = await this.makeRequest(url);
      const customContent = response as ICustomContentResponseBody;
      console.debug(`Loaded custom content by id ${id}.`);
      return customContent;
    } catch (e) {
      trackEvent(JSON.stringify(e), 'load_custom_content', 'error');
      // TODO: return a NullCustomContentObject
      return undefined;
    }
  }

  private async getCustomContentRawV2(id: string, query: string = 'body-format=raw'): Promise<ICustomContentResponseBodyV2 | undefined> {
    const url = `/api/v2/custom-content/${id}?${query}`;
    try {
      const response = await this.makeRequest(url);
      const customContent = response as ICustomContentResponseBodyV2;
      console.debug(`Loaded custom content by id ${id}.`);
      return customContent;
    } catch (e) {
      trackEvent(JSON.stringify(e), 'load_custom_content', 'error');
      // TODO: return a NullCustomContentObject
      return undefined;
    }
  }

  buildTypesClauseFilter(): string {
    const typeClause = (t: string) => `type="${this.customContentType(t)}"`;
    const typesClause = (a: Array<string>) => a.map(typeClause).join(' or ');
    return typesClause(CUSTOM_CONTENT_TYPES);
  }

  async buildSearchCustomConentUrl(keyword: string = '', onlyMine: boolean = false, docType: string = '', ids: number[] = [], limit?: number): Promise<string> {
    const typesClauseFilter = this.buildTypesClauseFilter();
    const spaceKeyFilter = (await this.getCurrentSpace()).key;
    let keywordFilter = '', onlyMineFilter = '', docTypeFilter = '', limitFilter = '' , idFilter = '';
    if (keyword != '') {
      const formatKeyword = keyword.replace(/[-:]/g, " ");
      keywordFilter = ` and (title ~ "${formatKeyword}*" or title ~ "*${formatKeyword}*" or title ~ "${formatKeyword}")`;
    }
    if (ids.length > 0) {
      const idList = ids.join(', ');
      idFilter = ` and id in (${idList})`;
  }
    if (onlyMine) onlyMineFilter = ` and contributor = "${this.currentUser?.atlassianAccountId}"`;
    if (docType != '') docTypeFilter = ``;
    if (limit != undefined) limitFilter = `&limit=${limit}`;
    const searchUrl = `/rest/api/content/search?cql=space="${spaceKeyFilter}" and (${typesClauseFilter}) ${keywordFilter} ${onlyMineFilter} ${docTypeFilter} ${idFilter} order by lastmodified desc${limitFilter}&expand=body.raw,version.number,container,space,body.storage,history.contributors.publishers.users`;
    return searchUrl;
  }

  async searchCustomContent(maxItems: number = SEARCH_CUSTOM_CONTENT_LIMIT): Promise<Array<ICustomContent>> {
    if (forgeGlobal.isForge) {
      // Forge mode: use the new API
      return await this.searchCustomContentForge(250);
    }

    // Connect mode: use the old API
    const searchUrl = await this.buildSearchCustomConentUrl();
    const searchAll = async (): Promise<Array<ICustomContent>> => {
      let url = searchUrl, data;
      let results: Array<ICustomContent> = [];
      do {
        data = await this.searchOnce(url);
        results = results.concat(data?.results);
        url = data?._links?.next || '';
      } while (url && results.length < maxItems);
      return results;
    };

    const searchAllWithFallback = async (): Promise<Array<ICustomContent>> => {
      const results = await searchAll();
      if (results.length) {
        return results;
      }

      const results2 = await this.getCustomContentByTypes(CUSTOM_CONTENT_TYPES);
      trackEvent(`found ${results2.length} content`, 'getCustomContentByTypes', 'info');
      return results2;
    };

    try {
      return await time(searchAllWithFallback, (duration, results) => {
        trackEvent(`found ${results.length} content, took ${duration} ms`, 'searchAll', 'info');
      });
    } catch (e) {
      console.error('searchCustomContent', e);
      trackEvent(JSON.stringify(e), 'searchCustomContent', 'error');
      return [] as Array<ICustomContent>;
    }
  }

  async searchCustomContentForge(maxItems: number = 2): Promise<Array<ICustomContent>> {
    try {
      // Use the new Forge API to search custom content
      const searchUrl = `/wiki/api/v2/custom-content?limit=${maxItems}&body-format=raw`;
      const response = await forgeRequest(searchUrl);
      
      if (!response || !response.results) {
        console.warn('No search results from Forge API');
        return [];
      }

      // Parse the results similar to how getCustomContentByIdV2 works
      const results = response.results.map((customContent: any) => {
        let diagram;
        try {
          diagram = JSON.parse(customContent.body.raw.value);
        } catch (e) {
          console.debug('Failed to parse custom content body', e);
          return null;
        }
        
        diagram.source = DataSource.CustomContent;
        diagram.id = customContent.id;
        
        const assign = Object.assign({}, customContent, { value: diagram });
        return assign as ICustomContent;
      }).filter((item: ICustomContent) => item && item.value && item.value.diagramType);

      trackEvent(`found ${results.length} content in Forge mode`, 'searchCustomContentForge', 'info');
      return results;
    } catch (e) {
      console.error('searchCustomContentForge', e);
      trackEvent(JSON.stringify(e), 'searchCustomContentForge', 'error');
      return [] as Array<ICustomContent>;
    }
  }

  async searchPagedCustomContent(pageSize: number = 25, keyword: string = '', onlyMine: boolean = false, docType: string = '', ids: number[] = []): Promise<SearchResults> {
    if (forgeGlobal.isForge) {
      return await this.searchPagedCustomContentForge(pageSize);
    }

    const searchUrl = await this.buildSearchCustomConentUrl(keyword, onlyMine, docType, ids, pageSize);
    return await this.searchPagedCustomContentByUrl(searchUrl);
  }

  async searchPagedCustomContentForge(pageSize: number = 25, followNext: boolean = false, includeUnknown: boolean = false): Promise<SearchResults> {
    const params = new URLSearchParams();
    CUSTOM_CONTENT_TYPES.forEach(type => {
      params.append('type', this.customContentType(type));
    });
    params.append('limit', pageSize.toString());
    params.append('body-format', 'raw');
    

    const searchUrl = `/wiki/api/v2/custom-content?${params.toString()}`;
    return await this.searchPagedCustomContentForgeByUrl(searchUrl, pageSize, followNext, includeUnknown);
  }

  async searchAllCustomContentForge(includeUnknown: boolean = false): Promise<SearchResults> {
    return await this.searchPagedCustomContentForge(250, true, includeUnknown);
  }

  async searchPagedCustomContentForgeByUrl(searchUrl: string, pageSize: number = 25, followNext: boolean = false, includeUnknown: boolean = false): Promise<SearchResults> {
    try {
      const response = await forgeRequest(searchUrl);
      
      if (!response || !response.results) {
        console.warn('No search results from Forge API');
        return {
          size: 0,
          results: []
        };
      }

      const parseAndFilterResponse = (r: any) => r.results.map((customContent: any) => {
        if(customContent.body.raw.value.length === 0) {
          console.warn('Empty custom content body for id', customContent.id);
          return null;
        }

        let diagram;
        try {
          diagram = JSON.parse(customContent.body.raw.value);
        } catch (e) {
          console.debug('Failed to parse custom content body', e);
          return null;
        }
        
        diagram.source = DataSource.CustomContent;
        diagram.id = customContent.id;
        
        const assign = Object.assign({}, customContent, { value: diagram });
        return assign as ICustomContent;
      }).filter((item: ICustomContent) => includeUnknown || item && item.value && item.value.diagramType);

      let results = parseAndFilterResponse(response);

      while((results.length < pageSize || followNext) && response._links?.next) {
        const nextResponse = await forgeRequest(response._links.next);
        if (!nextResponse || !nextResponse.results) {
          break;
        }
        const nextResults = parseAndFilterResponse(nextResponse);
        results = results.concat(nextResults);
        response._links.next = nextResponse._links?.next;
      }

      const searchResults: SearchResults = {
        size: results.length,
        results: results,
        _links: response._links
      };

      trackEvent(`found ${results.length} content in Forge mode`, 'searchPagedCustomContentForgeByUrl', 'info');
      console.debug('searchPagedCustomContentForgeByUrl results:', searchResults);
      return searchResults;
    } catch (e) {
      console.error('searchPagedCustomContentForgeByUrl', e);
      trackEvent(JSON.stringify(e), 'searchPagedCustomContentForgeByUrl', 'error');
      return {
        size: 0,
        results: []
      };
    }
  }

  async searchPagedCustomContentByUrl(searchUrl: string): Promise<SearchResults> {
    if (forgeGlobal.isForge) {
      return await this.searchPagedCustomContentForgeByUrl(searchUrl);
    }

    const searchCustomContent = async (): Promise<SearchResults> => {
      const data = await this.searchOnce(searchUrl);
      const results = data?.results || [];
      const size = results.length;
      const _links = data?._links;
      const r = {
        size,
        results,
        _links
      };
      console.debug({actiion: 'searchPagedCustomContentByUrl', searchResult: r});
      return r;
    };
    try {
      return await time(searchCustomContent, (duration, results) => {
        trackEvent(`found ${results.length} content, took ${duration} ms`, 'searchPagedCustomContentByUrl', 'info');
      });
    } catch (e) {
      console.error('searchPagedCustomContentByUrl', e);
      trackEvent(JSON.stringify(e), 'searchPagedCustomContentByUrl', 'error');
      return {
        size: 0,
        results: []
      };
    }
  }

  searchOnce = async (url: string): Promise<SearchResults> => {
    console.debug(`Searching content with ${url}`);
    const data = await this.request(url);
    console.debug(`${data?.size} results returned, has next? ${data?._links?.next != null}`);
    data.results = data?.results.map(this.parseCustomContent).filter((c: ICustomContent) => c.value && c.value.diagramType);
    console.debug({action: 'searchOnce', data: data});
    return data;
  };

  buildUrl = (sourceUrl: string, newPath: string): string => {
    if (newPath && newPath.startsWith("/")) {
      newPath = newPath.substring(1);
    }
    return `${this.extractDomainFromURL(sourceUrl)}/${newPath}`;
  }

  extractDomainFromURL = (url: string): string => {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.origin;
    } catch (error) {
      console.error("Invalid URL:", error);
      return '';
    }
  }

  parseCustomContent = (customContent: ICustomContentResponseBody): ICustomContent => {
    const result = <unknown>Object.assign({}, customContent, {
      value: this.parseCustomContentDiagram(customContent),
      container: Object.assign({}, customContent.container, this.parseCustomContentContainer(customContent)),
      author: this.parseUser(customContent?.history?.createdBy),
      contributors: this.parseCustomContentContributors(customContent)
    });
    console.debug(`converted result: `, result);
    return result as ICustomContent;
  };

  parseUser = (accountUser: AccountUser | undefined): User | undefined => {
    if (accountUser == undefined) return undefined
    let accountId = accountUser.accountId || '';
    let selfLink = accountUser._links?.self || '';
    let user: User = {
      id: accountId,
      name: accountUser.displayName || '',
      avatar: this.buildUrl(selfLink, accountUser.profilePicture?.path || ''),
      link: this.buildUrl(selfLink, 'wiki/display/~' + accountId),
    };
    return user;
  }

  parseCustomContentContributors = (customContent: ICustomContentResponseBody): Array<User> => {
    let contributors: Array<User> = [];
    const accountUsers = customContent?.history?.contributors?.publishers?.users || new Array<AccountUser>;
    for (let i = 0; i < accountUsers.length; i++) {
      let user = this.parseUser(accountUsers[i]);
      if (user == undefined) continue;
      contributors.push(user);
    }
    return contributors;
  };

  parseCustomContentContainer = (customContent: ICustomContentResponseBody): any => {
    let container: { link: string | undefined } = {link: undefined};
    try {
      let webui = customContent?.container?._links?.webui || '';
      let selfUrl = customContent?.container?._links?.self || '';
      container.link = this.buildUrl(selfUrl, 'wiki' + webui);
    } catch (e) {
      console.error('parseCustomContentContainer error: ', e);
      trackEvent(JSON.stringify(e), 'parseCustomContentContainer', 'error');
    }
    return container;
  };

  parseCustomContentDiagram = (customContent: ICustomContentResponseBody): any => {
    let diagram: any;
    const rawValue = customContent?.body?.raw?.value;
    if (rawValue) {
      try {
        diagram = JSON.parse(rawValue);
        if (diagram.diagramType == undefined) return null;
        diagram.source = DataSource.CustomContent;
      } catch (e) {
        console.error(`parseCustomContentDiagram error: `, e, `raw value: ${rawValue}`);
        trackEvent(JSON.stringify(e), 'parseCustomContentDiagram', 'error');
      }
    }
    return diagram;
  };

  async getCustomContentByType(type: string): Promise<Array<ICustomContent>> {
    try {
      const space = await this.getCurrentSpace();
      const spaceId = space.id;
      const url = `/api/v2/spaces/${spaceId}/custom-content?type=${this.customContentType(type)}&body-format=raw`;
      const response: { results: Array<any> } = await this.request(url);

      const parseCustomContentBodyV2 = (customContent: ICustomContentResponseBodyV2): ICustomContent => {
        let diagram: any;
        const rawValue = customContent?.body?.raw?.value;
        if (rawValue) {
          try {
            diagram = JSON.parse(rawValue);
            diagram.source = DataSource.CustomContent;
          } catch (e) {
            console.error(`parseCustomContentBodyV2 error: `, e, `raw value: ${rawValue}`);
            trackEvent(JSON.stringify(e), 'parseCustomContentBodyV2', 'error');
          }
        }
        const result = <unknown>Object.assign({}, customContent, {value: diagram}, {container: {id: customContent.pageId}});
        console.debug(`converted result: `, result);
        return result as ICustomContent;
      };

      return response.results.map(parseCustomContentBodyV2).filter(c => c.value?.diagramType);
    } catch (e) {
      console.error('getCustomContentByType:', e);
      trackEvent(JSON.stringify(e), 'getCustomContentByType', 'error');
      return [];
    }
  }

  async getCustomContentByTypes(types: Array<string>): Promise<Array<ICustomContent>> {
    const [r1, r2] = await Promise.all(types.map(t => this.getCustomContentByType(t)));
    return r1?.concat(r2);
  }

  async saveCustomContent(customContentId: string, value: Diagram) {
    let result;
    // TODO: Do we really need to check whether it exists?
    const existing = await this.getCustomContentById(customContentId);
    const pageId = await this._page.getPageId();
    const count = (await this._page.countMacros((m) => {
      return m?.customContentId?.value === customContentId;
    }));

    // pageId is absent when editing in custom content list page;
    // Make sure we don't update custom content on a different page
    // and there is only one macro linked to the custom content on the current page.
    if (existing && (!pageId || (String(pageId) === String(existing?.container?.id) && count === 1))) {
      result = await this.updateCustomContent(existing, value);
    } else {
      if (count > 1) {
        console.warn(`Detected copied macro on the same page ${pageId}.`);
      }
      if (String(pageId) !== String(existing?.container?.id)) {
        console.warn(`Detected copied macro on page ${pageId} (current) and ${existing?.container?.id}.`);
      }
      result = await this.createCustomContent(value);
    }
    return result
  }

  async saveCustomContentV2(customContentId: string, value: Diagram): Promise<ICustomContentResponseBodyV2> {
    let result;
    // TODO: Do we really need to check whether it exists?
    const existing = await this.getCustomContentByIdV2(customContentId);
    const pageId = await this._getCurrentPageId();
    const count = (await this._page.countMacros((m) => {
      return m?.customContentId === customContentId //new forge custom content
        || m?.customContentId?.value === customContentId;
    }));

    // pageId is absent when editing in custom content list page;
    // Make sure we don't update custom content on a different page
    // and there is only one macro linked to the custom content on the current page.
    if (existing && (!pageId || (String(pageId) === String(existing?.pageId) && count === 1))) {
      try {
        result = await this.updateCustomContentV2(existing, value);
      } catch (error) {
        trackEvent('update_custom_content_error', { error: error?.message });
        throw error;
      }
    } else {
      if (count > 1) {
        console.warn(`Detected copied macro on the same page ${pageId}.`);
      }
      if (String(pageId) !== String(existing?.pageId)) {
        console.warn(`Detected copied macro on page ${pageId} (current) and ${existing?.pageId}.`);
      }
      result = await this.createCustomContentV2(value);
    }
    return result;
  }

  getDialogCustomData() {
    if(forgeGlobal.isForge) {
      return Promise.resolve(undefined);
    }
    const dialog = this._dialog;
    return new Promise((resolv: Function) => {
      try {
        dialog.getCustomData((data: unknown) => {
          resolv(data);
        });
      } catch (e) {
        // eslint-disable-next-line
        console.error('error getting custom data:', e);
        resolv();
      }
    });
  }

  isDisplayMode() {
    // Check if we're in a Forge modal - hide header in this case
    if (forgeGlobal.isForge && forgeGlobal.forgeContext?.extension?.modal) {
      return false;
    }
    // Check for display mode in URL or regular Forge mode
    return getUrlParam('outputType') === 'display' || forgeGlobal.isForge;
  }

  async getCustomContent(): Promise<ICustomContent | undefined> {
    const macroData = await this.getMacroData();
    if (macroData && macroData.customContentId) {
      return this.getCustomContentById(macroData.customContentId);
    }
    return undefined;
  }

  async getAttachmentsV2(pageId?: string, queryParameters?: any): Promise<Array<Attachment>> {
    pageId = pageId || await this._getCurrentPageId();
    queryParameters = queryParameters || {};
    const param = Object.keys(queryParameters).reduce((acc, i) => `${acc}${acc ? '&' : ''}${i}=${queryParameters[i]}`, '');
    const url = `/api/v2/pages/${pageId}/attachments${param ? `?${param}` : ''}`;
    const response = await this.makeRequest(url);
    const base = await this._getBaseUrl();
    return response?.results && response?.results.map((a: any) => Object.assign(a, {
      _links: {
        base,
        download: a.downloadLink
      }
    })) || [];
  }

  async getAttachments(pageId?: string, queryParameters?: any): Promise<Array<Attachment>> {
    pageId = pageId || await this._getCurrentPageId();
    queryParameters = queryParameters || {};
    const param = Object.keys(queryParameters).reduce((acc, i) => `${acc}${acc ? '&' : ''}${i}=${queryParameters[i]}`, '');
    const url = `/rest/api/content/${pageId}/child/attachment${param ? `?expand=version&${param}` : ''}`;
    const response = await this.makeRequest(url);
    console.debug(`found attachments in page ${pageId} with params ${queryParameters}:`, response);
    const baseLinks = {base: response._links.base, context: response._links.context};
    //set 'comment' as top level field to be consistent with V2 API response
    return response?.results.map((a: any) => Object.assign(a, {
      comment: a.metadata?.comment,
      _links: Object.assign(a._links, baseLinks)
    })) || [];
  }

  async _getCurrentUser(): Promise<IUser> {
    if(forgeGlobal.isForge) {
      return {atlassianAccountId: forgeGlobal.forgeContext.accountId};
    }

    try {
      const response = await this._requestFn({
        url: '/rest/api/user/current',
        type: 'GET',
        contentType: 'application/json'
      });

      const userData = response.body ? JSON.parse(response.body) : response;
      return {
        atlassianAccountId: userData.accountId,
        displayName: userData.displayName,
        publicName: userData.publicName,
        email: userData.email,
        accountType: userData.accountType
      };
    } catch (error) {
      console.error('Error fetching current user via REST API:', error);
      // Fallback to JavaScript API if REST fails
      return new Promise(resolv => this._user.getCurrentUser((user: IUser) => resolv(user)));
    }
  }

  async getCurrentSpace(): Promise<ISpace> {
    return this.currentSpace || (this.currentSpace = forgeGlobal.isForge 
        ? forgeGlobal.forgeContext.extension.space 
        : (await this._page.getSpace() || {key: await this._page.getSpaceKey()}));
  }

  async _getCurrentPageId(): Promise<string> {
    return this.currentPageId || (this.currentPageId = forgeGlobal.isForge ? forgeGlobal.forgeContext.extension.content?.id : await this._page.getPageId());
  }

  async _getCurrentPageUrl(): Promise<string> {
    return this.currentPageUrl || (this.currentPageUrl = forgeGlobal.isForge ? forgeGlobal.forgeContext.extension.location : await this._page.getHref());
  }

  async _getBaseUrl(): Promise<string> {
    const baseOf = (url: string) => {
      const u = new URL(url);
      const parts = u.pathname.split('/');
      const firstPart = parts.length > 0 && parts[1];
      return `${u.origin}/${firstPart}`;
    };
    return this.baseUrl || (this.baseUrl = baseOf(await this._getCurrentPageUrl()));
  }

  async _getLicense(_addonKey: string = ''): Promise<ILicense | undefined> {
    const url = `/rest/atlassian-connect/1/addons/${_addonKey || addonKey()}`;
    try {
      const license: ILicense = await this.request(url);
      console.debug("getLicense", url, license);
      trackEvent(JSON.stringify(license), 'getLicense', 'info');
      return license;
    } catch (e) {
      console.error('getLicense', e);
      trackEvent(JSON.stringify(e), 'getLicense', 'error');
      return undefined;
    }
  }

  async hasFullAddon(): Promise<boolean> {
    const fullAddonKey: string = addonKey().replace('-lite', '');
    console.debug('check full addon: ', fullAddonKey)
    return await this._getLicense(fullAddonKey) != null;
  }

  async _getLocationTarget(): Promise<LocationTarget> {
    return this.locationTarget || (this.locationTarget = await this._page.getLocationTarget());
  }

  async isInContentEditOrContentCreate(): Promise<boolean> {
    const target = await this._getLocationTarget();
    return target === LocationTarget.ContentEdit || target === LocationTarget.ContentCreate;
  }

  async canUserEdit(): Promise<boolean> {
    if(forgeGlobal.isForge) {
      //TODO: check if the user has edit permission
      return true;
    }
    
    const pageId = await this._page.getPageId();
    return await CheckPermission(pageId, this.currentUser?.atlassianAccountId || '', this._requestFn as PermissionCheckRequestFunc)
  }

  isLite(): boolean {
    // @ts-ignore
    return forgeGlobal.isForge ? forgeGlobal.isLite : getUrlParam('addonKey')?.includes('lite');
  }

  /**
   * Common request method that handles both forge and connect modes
   * @param url The API endpoint URL (without /wiki prefix)
   * @param method HTTP method (GET, POST, PUT, etc.)
   * @param data Request body data (optional)
   * @param parseFunction Optional custom parsing function for connect mode
   * @returns Parsed response data
   */
  private async makeRequest(url: string, method: string = 'GET', data: any = undefined, parseFunction?: (response: any) => any): Promise<any> {
    if (forgeGlobal.isForge) {
      return await forgeRequest(`/wiki${url}`, method, data);
    } else {
      const response = await this._requestFn(data ? {
        type: method,
        url,
        data: JSON.stringify(data),
        contentType: 'application/json'
      } : {type: method, url});
      
      if (parseFunction) {
        return parseFunction(response);
      }
      // Default parsing: forge mode returns response as-is, connect mode parses JSON
      return forgeGlobal.isForge ? response : response && response.body && JSON.parse(response.body);
    }
  }

  async request(url: string, type: string = 'GET', data: any = undefined): Promise<any> {
    return this.makeRequest(url, type, data);
  }

  async requestAllPaginatedData(initialUrl: string, consumer: (data: any) => void): Promise<any> {
    return loadAllPaginatedData(this.request.bind(this), initialUrl, consumer);
  };

  appPropertyUrl = (key: string) => `/rest/atlassian-connect/1/addons/${addonKey()}/properties/${key}`;

  async getAppProperty(propertyKey: string = ''): Promise<any> {
    if(forgeGlobal.isForge) {
      //TODO: Migrate the usage of AppProperty to Forge API
      return;
    }
    const url = this.appPropertyUrl(propertyKey);
    try {
      return (await this.request(url)).value;
    } catch (e) {
      console.error(`getAppProperty ${propertyKey} error`, e);
    }
  }

  async setAppProperty(propertyKey: string = '', value: any = undefined): Promise<any> {
    if(forgeGlobal.isForge) {
      return;
    }
    const url = this.appPropertyUrl(propertyKey);
    return (await this.request(url, 'PUT', value));
  }

  async getCurrentPage(): Promise<{title: string, body: {export_view: {value: string}}} | undefined> {
    const pageId = await this._getCurrentPageId();
    return await this.request(`/api/v2/pages/${pageId}?body-format=export_view&get-draft=true`);
  }

  async getToken(): Promise<string> {
    return this._context.getToken();
  }

  /**
   * Gets all versions of a custom content item and prints them to the console
   * @param contentId The ID of the custom content item
   * @returns Array of version objects
   */
  async getAndPrintContentVersions(contentId: string): Promise<any[]> {
    try {
      // Using the V2 API as specified in the documentation
      // https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-custom-content/#api-custom-content-id-get
      const url = `/api/v2/custom-content/${contentId}/versions?body-format=raw&limit=100`;
      const data = await this.makeRequest(url);
      const versions = data.results || [];

      console.log(`%cFound ${versions.length} versions for content ID: ${contentId}`, 'color: #4B5563; font-size: 14px; font-weight: bold;');

      // Create an array to store version data for table display
      const tableData = [];

      // Create a textarea for copying
      const textarea = document.createElement('textarea');
      textarea.style.position = 'fixed';
      textarea.style.top = '10px';
      textarea.style.right = '10px';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);

      // Print each version details
      for (let i = 0; i < versions.length; i++) {
        const version = versions[i];

        // Style for version header
        console.log(`%c╔══ Version ${version.number} ══╗`, 'color: #1E40AF; background-color: #DBEAFE; font-size: 14px; font-weight: bold; padding: 5px; border-radius: 3px;');
        console.log(`%c║ Created: ${new Date(version.createdAt).toLocaleString()}`, 'color: #4B5563; padding-left: 10px;');

        // Fetch the specific version content
        try {
          const versionContentUrl = `/api/v2/custom-content/${contentId}?version=${version.number}&body-format=raw`;
          const versionData = await this.makeRequest(versionContentUrl);
          if (versionData.body?.raw?.value) {
            const diagramData = JSON.parse(versionData.body.raw.value);

            // Extract code based on diagram type
            const code = diagramData.diagramType === DiagramType.Mermaid ?
              (diagramData.mermaidCode || '') :
              (diagramData.code || '');

            // Add data to table array
            tableData.push({
              version: version.number,
              created: new Date(version.createdAt).toLocaleString(),
              title: diagramData.title || 'Untitled',
              codeLength: code ? code.length : 0
            });

            console.log(`%c║ Title: ${diagramData.title || 'Untitled'}`, 'color: #1F2937; padding-left: 10px; font-weight: bold;');

            // Style code differently based on diagram type
            if(diagramData.diagramType === DiagramType.Mermaid) {
              console.log(`%c║ Code (select and copy): `, 'color: #4B5563; padding-left: 10px;');
              console.log(`${code || 'Empty'}`);

              // Create a copy button
            } else {
              console.log(`%c║ Code (select and copy): `, 'color: #4B5563; padding-left: 10px;');
              console.log(`${code || 'Empty'}`);

              // Create a copy button
            }
          }
        } catch (e) {
          console.log(`%c║ Could not fetch or parse version content`, 'color: #B91C1C; padding-left: 10px;');
          console.error(e);
        }
        console.log(`%c╚════════════════╝`, 'color: #1E40AF; background-color: #DBEAFE; font-size: 14px; font-weight: bold; padding: 5px; border-radius: 3px;');
      }

      // Display a formatted table of all versions
      if (tableData.length > 0) {
        console.log('%cVersion Summary Table:', 'color: #1E40AF; font-size: 16px; font-weight: bold;');
        console.table(tableData, ['version', 'created', 'title', 'type', 'codeLength']);
      }

      // Clean up
      document.body.removeChild(textarea);

      return versions;
    } catch (e) {
      console.error('Error getting content versions:', e);
      trackEvent(JSON.stringify(e), 'get_content_versions', 'error');
      return [];
    }
  }
}
