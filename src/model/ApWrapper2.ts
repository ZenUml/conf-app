import {trackEvent, addonKey} from '@/utils/window';
import time from '@/utils/timer';
import {IApWrapper, VersionType} from "@/model/IApWrapper";
import {IMacroData} from "@/model/IMacroData";
import {IContentProperty} from "@/model/IContentProperty";
import {ICustomContent, ICustomContentV2, SearchResults, User} from "@/model/ICustomContent";
import {IUser} from "@/model/IUser";
import {ILicense} from "@/model/ILicense";
import {DataSource, Diagram, DiagramType} from "@/model/Diagram/Diagram";
import {
  AccountUser,
  ICustomContentResponseBody,
  ICustomContentResponseBodyV2
} from "@/model/ICustomContentResponseBody";
import {AtlasPage} from "@/model/page/AtlasPage";
import {ISpace, LocationTarget} from './ILocationContext';
import {Attachment} from './ConfluenceTypes';
import { loadAllPaginatedData } from '@/utils/requestUtil';
import forgeGlobal from '@/model/globals/forgeGlobal';
import {forgeRequest} from '@/utils/requestUtil';
import { SpaceAdmin } from './SpaceAdmin';
import SpaceAdminResolver from './permissions/SpaceAdminResolver';

const CUSTOM_CONTENT_TYPES = ['zenuml-content-sequence', 'zenuml-content-graph'];
const SEARCH_CUSTOM_CONTENT_LIMIT: number = 1000;

// ZEN-1170 Defect 1: discriminated result for legacy content-property reads.
// Viewers can collapse anything non-'ok' to "no content"; editors must
// distinguish 'not_found' (legitimate new macro — body genuinely doesn't
// exist) from forbidden/error/page_not_found (unsafe to treat as new —
// would risk overwriting legacy data on save).
//
// CRITICAL: on the V2 endpoint `/pages/{pageId}/properties?key={key}`:
//   - HTTP 200 + `results: []` = key genuinely not present → 'not_found' (safe)
//   - HTTP 404                  = PAGE itself not reachable → 'page_not_found' (unsafe)
// The 404 means we couldn't verify whether the key exists, so the editor
// must fail closed and refuse to mount a fresh placeholder.
export type ContentPropertyV2Result =
  | { status: 'ok'; property: IContentProperty }
  | { status: 'not_found' }
  | { status: 'page_not_found' }
  | { status: 'forbidden' }
  | { status: 'error'; reason: 'http' | 'parse' | 'thrown'; httpStatus?: number };

export default class ApWrapper2 implements IApWrapper {
  versionType: VersionType;
  _page: AtlasPage;
  currentUser: IUser | undefined;
  currentSpace: ISpace | undefined;
  currentPageId: string | undefined;
  currentPageUrl: string | undefined;
  baseUrl: string | undefined;
  locationTarget: LocationTarget | undefined;
  license: ILicense | undefined;
  private readonly spaceAdminResolver: SpaceAdminResolver;

  constructor() {
    this.versionType = this.isLite() ? VersionType.Lite : VersionType.Full;
    this._page = new AtlasPage();
    this.spaceAdminResolver = new SpaceAdminResolver(this);
  }

  async initializeContext(): Promise<void> {
    try {
      this.currentUser = await this._getCurrentUser();
      this.currentSpace = await this.getCurrentSpace();
      this.currentPageUrl = await this._getCurrentPageUrl();
      this.baseUrl = await this._getBaseUrl();
      this.locationTarget = await this._getLocationTarget();
      this.currentPageId = forgeGlobal.forgeContext?.extension?.content?.id || await this._page.getPageId();
      if (this.versionType === VersionType.Full) {
        this.license = forgeGlobal.forgeContext?.license;
      }
      console.debug('initializeContext', this.currentUser, this.currentSpace, this.currentPageUrl, this.locationTarget, this.currentPageId, this.license);

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

  async getMacroData(): Promise<IMacroData | undefined> {
    return forgeGlobal.forgeContext?.extension?.config as IMacroData | undefined;
  }

  async getMacroBody(): Promise<string | undefined> {
    return undefined;
  }

  getContentProperty(_key: any): Promise<IContentProperty | undefined> {
    return Promise.resolve(undefined);
  }

  // ZEN-1170 Defect 1: discriminated content-property read used by the Forge
  // viewer/editor legacy-fallback paths. The legacy `getContentProperty` above
  // collapses every failure to `undefined`, which is safe for viewer-only
  // callers but unsafe for editors (a transient 403 would look identical to
  // "no legacy property" and the user could save over the legacy data).
  async getContentPropertyV2(key: string): Promise<ContentPropertyV2Result> {
    // Resolve pageId with the same fallback chain as initializeContext, since
    // not every Forge entry point calls initializeContext() before reaching
    // here (e.g. forge-graph-editor.ts). Without this fallback, the editor's
    // legacy-fallback path would always see status='error' and incorrectly
    // mount EMPTY_GRAPH with saves blocked instead of restoring the legacy
    // diagram body.
    let pageId = this.currentPageId
      || forgeGlobal.forgeContext?.extension?.content?.id;
    if (!pageId) {
      try { pageId = await this._page.getPageId(); } catch { /* fall through */ }
    }
    if (!pageId) return { status: 'error', reason: 'thrown' };
    try {
      // Use V2 properties endpoint with ?key= filter. The V1 endpoint
      // (/wiki/rest/api/content/{id}/property/{key}) returns 410 Gone via
      // Forge's requestConfluence proxy even though it still works for
      // direct REST clients. V2 supports the same get-by-key shape via
      // query param + returns a results array.
      const url = `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/properties?key=${encodeURIComponent(key)}`;
      const { requestConfluence } = await import('@forge/bridge');
      const res = await requestConfluence(url);
      if (res.status === 403) return { status: 'forbidden' };
      // V2 404 = the PAGE isn't reachable (wrong id, deleted, perms). It is
      // NOT the same as "key doesn't exist on this page" — that's a 200 with
      // empty results. Returning 'not_found' here would let editors treat a
      // failed page lookup as "safe to start fresh" and destructively save
      // over legacy data on a different page id we never actually probed.
      if (res.status === 404) return { status: 'page_not_found' };
      if (!res.ok) return { status: 'error', reason: 'http', httpStatus: res.status };
      try {
        const body = (await res.json()) as { results?: Array<{ value?: unknown; version?: { number: number } }> };
        const first = body.results?.[0];
        if (!first) return { status: 'not_found' }; // V2 returns 200 with empty results for missing key
        return {
          status: 'ok',
          property: { value: first.value as IContentProperty['value'], version: first.version },
        };
      } catch {
        return { status: 'error', reason: 'parse' };
      }
    } catch {
      return { status: 'error', reason: 'thrown' };
    }
  }

  // All document types will be using the same content key.
  // Old documents that uses the old content key will not be migrated.
  // We may migrate them in the future.
  getContentKey() {
    return forgeGlobal.isDiagramly ? 'gpt-custom-content-key' : 'zenuml-content-sequence';
  }

  getCustomContentTypePrefix() {
    let key;
    if (forgeGlobal.isDiagramly) {
      key = 'gptdock-confluence';
    } else {
      key = `com.zenuml.confluence-addon${forgeGlobal.isLite ? '-lite' : ''}`;
    }
    console.debug('getCustomContentTypePrefix', key);
    return `ac:${key}`;
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
    // ZEN-1170: strip UI/control-plane fields before serializing. See
    // saveCustomContentV2 for the full rationale — these flags drive viewer
    // chrome and persistence behavior and must never round-trip through
    // the stored CC body, or the migrated macro stays trapped in the
    // recovery UI forever. saveCustomContentV2's update branch sanitises
    // there; this is the direct-create branch (called e.g. by
    // CustomContentStorageProvider.save when source !== 'custom-content',
    // which is the Defect 1 legacy-migration path).
    const { recoveredFromOrphan: _rfo, recoveredFromOrphanId: _rid, legacyLoadBlocked: _llb, ...sanitizedContent } = content as any;
    const data: any = {
      "type": type,
      "pageId": await this._getCurrentPageId(),
      "title": content.title || `Untitled ${new Date().toISOString()}`,
      "body": {
        "value": JSON.stringify(sanitizedContent),
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

  private isVersionConflict(error: any): boolean {
    const msg = String(error?.message || error?.responseText || JSON.stringify(error));
    return msg.includes('Version must be incremented');
  }

  private buildStructuredErrorProps(error: any): { error_message: string; http_status: string | number } {
    return {
      error_message: String(error?.message || error?.responseText || error).substring(0, 500),
      http_status: error?.status || error?.statusCode || error?.xhr?.status || 'unknown',
    };
  }

  async updateCustomContentV2(content: ICustomContentV2, newBody: Diagram): Promise<ICustomContentResponseBodyV2> {
    let newVersionNumber = 1;

    if (content.version?.number) {
      newVersionNumber += content.version?.number
    }
    // Must provide at most one of [spaceId, pageId, blogPostId, or customContentId]
    const buildData = (versionNumber: number) => ({
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
        "number": versionNumber
      }
    });

    try {
      const response = await this.makeRequest(`/api/v2/custom-content/${content.id}`, 'PUT', buildData(newVersionNumber));
      trackEvent(JSON.stringify(content.id), 'update_custom_content', 'info');
      return response as ICustomContentResponseBodyV2;
    } catch (error) {
      if (this.isVersionConflict(error)) {
        trackEvent('save_conflict_retry', 'save_conflict_retry', 'info', { content_id: String(content.id) });
        const fresh = await this.makeRequest(`/api/v2/custom-content/${content.id}?body-format=raw`);
        const freshVersion = (fresh?.version?.number || 0) + 1;
        try {
          const retryResponse = await this.makeRequest(`/api/v2/custom-content/${content.id}`, 'PUT', buildData(freshVersion));
          trackEvent(JSON.stringify(content.id), 'update_custom_content', 'info');
          return retryResponse as ICustomContentResponseBodyV2;
        } catch (retryError) {
          trackEvent('update_custom_content_error', 'update_custom_content_error', 'error', this.buildStructuredErrorProps(retryError));
          throw retryError;
        }
      }
      trackEvent('update_custom_content_error', 'update_custom_content_error', 'error', this.buildStructuredErrorProps(error));
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
    let isCrossPageCopy = pageId && customContent?.container?.id && String(pageId) !== String(customContent.container.id);
    if (isCrossPageCopy || count > 1) {
      diagram.isCopy = true;
      diagram.copyReason = isCrossPageCopy ? 'cross-page' : 'same-page-duplicate';
      console.warn(`Detected copied macro - ID: ${id}, Cross-page copy: ${isCrossPageCopy}, Instances on page: ${count}, Source page: ${customContent?.container?.id}, Current page: ${pageId}`);
      if (isCrossPageCopy) {
        trackEvent('cross_page', 'duplication_detect', 'warning');
      }
      if (count > 1) {
        trackEvent('same_page', 'duplication_detect', 'warning');
      }
    } else {
      diagram.isCopy = false;
      diagram.copyReason = undefined;
    }
    diagram.id = id;
    let assign = <unknown>Object.assign({}, customContent, {value: diagram});
    return <ICustomContent>assign;
  }

  async getCustomContentByIdV2(id: string): Promise<ICustomContentV2 | undefined> {
    const customContent = await this.makeRequest(`/api/v2/custom-content/${id}?body-format=raw`);
    return this.parseCustomContentByIdV2Response(id, customContent);
  }

  // ZEN-1170 Defect 2b. Distinguish "the CC genuinely doesn't exist" (404 /
  // NOT_FOUND) from "the request failed for some other reason" (403, 5xx,
  // malformed response, thrown). Recovery is only safe in the first case —
  // probing and rewriting a sibling on top of a transient failure would
  // cause false repairs. Returns a structured result so the loader can
  // decide whether to probe.
  private async fetchCustomContentByIdV2WithStatus(id: string): Promise<{
    customContent: ICustomContentV2 | undefined;
    status: 'ok' | 'not_found' | 'other_error';
    errorDetail?: string;
  }> {
    let rawResponse: any;
    try {
      rawResponse = await this.makeRequest(`/api/v2/custom-content/${id}?body-format=raw`);
    } catch (e: any) {
      return { customContent: undefined, status: 'other_error', errorDetail: e?.message ? String(e.message) : String(e) };
    }
    const errors = rawResponse?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      // Strict 404 detection: every error in the array must be a true 404
      // (status === 404 AND code === 'NOT_FOUND'). A mixed array — or a
      // single error with mismatched status/code — must be treated as
      // 'other_error' so recovery does not trigger and the write path
      // does not fall through to create on transient failures.
      const allStrictNotFound = errors.every(
        (err: any) => err?.status === 404 && err?.code === 'NOT_FOUND',
      );
      const status: 'not_found' | 'other_error' = allStrictNotFound ? 'not_found' : 'other_error';
      // Telemetry for non-success shapes preserved from the legacy parsing path.
      trackEvent(String(id), 'load_custom_content_v2_missing', 'warning');
      return { customContent: undefined, status, errorDetail: JSON.stringify(errors) };
    }
    if (!rawResponse?.body?.raw?.value) {
      // Truthy response but no parseable body — unexpected shape, not a 404.
      trackEvent(String(id), 'load_custom_content_v2_missing', 'warning');
      return { customContent: undefined, status: 'other_error', errorDetail: 'malformed_or_empty_response' };
    }
    const parsed = await this.parseCustomContentByIdV2Response(id, rawResponse);
    return { customContent: parsed, status: parsed ? 'ok' : 'other_error' };
  }

  private async parseCustomContentByIdV2Response(id: string, customContent: any): Promise<ICustomContentV2 | undefined> {
    // forgeRequest returns the parsed JSON body regardless of HTTP status —
    // a 404 surfaces as { errors: [{ status: 404, code: 'NOT_FOUND', … }] }
    // (truthy but missing body.raw.value). Previously the next line crashed
    // with TypeError → viewer iframe collapsed to 0 height (ZEN-1170). Treat
    // any non-success shape as "not found" so callers fall through to
    // NULL_DIAGRAM / fallback paths instead of vanishing.
    const rawValue = customContent?.body?.raw?.value;
    if (!rawValue || customContent?.errors) {
      trackEvent(String(id), 'load_custom_content_v2_missing', 'warning');
      return undefined;
    }
    let diagram = JSON.parse(rawValue);
    diagram.source = DataSource.CustomContent;
    const count = (await this._page.countMacros((m) => {
      //TODO: filter by macro type
      return m?.customContentId?.value === id;
    }));
    console.debug(`Found ${count} macros on page`);

    const pageId = await this._page.getPageId();
    // Require both sides present — undefined pageId on the custom content
    // (e.g. content created via REST API without a container) previously
    // caused a false-positive isCopy=true (issue #80).
    let isCrossPageCopy = pageId && customContent?.pageId && pageId !== String(customContent.pageId);
    if (isCrossPageCopy || count > 1) {
      diagram.isCopy = true;
      diagram.copyReason = isCrossPageCopy ? 'cross-page' : 'same-page-duplicate';
      console.warn(`Detected copied macro - ID: ${id}, Cross-page copy: ${isCrossPageCopy}, Instances on page: ${count}, Source page: ${customContent?.pageId}, Current page: ${pageId}`);
      if (isCrossPageCopy) {
        trackEvent('cross_page', 'duplication_detect', 'warning');
      }
      if (count > 1) {
        trackEvent('same_page', 'duplication_detect', 'warning');
      }
    } else {
      diagram.isCopy = false;
      diagram.copyReason = undefined;
    }
    diagram.id = id;
    let assign = <unknown>Object.assign({}, customContent, {value: diagram});
    return <ICustomContentV2>assign;
  }

  // ZEN-1170 read-only probe. When a viewer's customContentId can no longer
  // be loaded (404, deleted, restricted) we list the host page's own
  // custom-content children and look for one whose stored `body.id` equals
  // the orphan id — that's the surviving sibling created by the historical
  // cross-page-copy → dedupe flow. The result is reported to Mixpanel so we
  // can estimate fleet-wide recoverability before shipping any auto-repair.
  //
  // No writes. No state changes. Safe to call from any viewer entry.
  async probeOrphanRecovery(
    pageId: string,
    orphanId: string,
  ): Promise<{
    recoverable: boolean | 'probe_failed';
    candidateCount: number;
    pageChildrenTotal: number;
    candidateIds?: string[];
    truncated?: boolean;
    probeError?: string;
  }> {
    // The Forge save path stores everything under one type, but historical
    // (Connect-era) graph custom content still lives under the dedicated
    // `zenuml-content-graph` type — so a graph macro whose orphan survivor
    // was created back then is invisible to a sequence-typed listing. Probe
    // both lite/full types; diagramly only has its own single type.
    const limit = 250;
    const typesToProbe = forgeGlobal.isDiagramly
      ? [this.customContentType('gpt-custom-content-key')]
      : [
          this.customContentType('zenuml-content-sequence'),
          this.customContentType('zenuml-content-graph'),
        ];
    try {
      const responses = await Promise.all(
        typesToProbe.map(t =>
          this.makeRequest(`/api/v2/pages/${pageId}/custom-content?type=${encodeURIComponent(t)}&body-format=raw&limit=${limit}`),
        ),
      );
      const errored = responses.find(r => r?.errors);
      if (errored) {
        return {
          recoverable: 'probe_failed',
          candidateCount: 0,
          pageChildrenTotal: 0,
          probeError: JSON.stringify(errored.errors),
        };
      }
      const candidateIds: string[] = [];
      let pageChildrenTotal = 0;
      let truncated = false;
      for (const response of responses) {
        const results: Array<any> = Array.isArray(response?.results) ? response.results : [];
        pageChildrenTotal += results.length;
        if (results.length >= limit && response?._links?.next) {
          truncated = true;
        }
        for (const child of results) {
          const rawValue = child?.body?.raw?.value;
          if (!rawValue) continue;
          try {
            const body = JSON.parse(rawValue);
            if (body?.id && String(body.id) === String(orphanId) && child?.id) {
              candidateIds.push(String(child.id));
            }
          } catch {
            // malformed body — counted in total but not as a match
          }
        }
      }
      return {
        recoverable: candidateIds.length > 0,
        candidateCount: candidateIds.length,
        pageChildrenTotal,
        ...(candidateIds.length > 0 && { candidateIds }),
        ...(truncated && { truncated: true }),
      };
    } catch (e: any) {
      return {
        recoverable: 'probe_failed',
        candidateCount: 0,
        pageChildrenTotal: 0,
        probeError: e?.message ? String(e.message) : String(e),
      };
    }
  }

  // ZEN-1170 Defect 2b. Read-OR-recover for the macro's referenced CC.
  // - On happy path: returns the requested CC, no recovery marker.
  // - When the requested CC 404s AND the page has exactly one custom-content
  //   child whose body.id matches the orphan id: fetch that child and return
  //   it with `recoveredFromOrphanId` set, so callers can render/edit/save
  //   against the surviving sibling. Ambiguous matches (>1 candidates) are
  //   intentionally not auto-recovered.
  // - Other direct-fetch failures (403, 5xx, malformed, thrown) do NOT
  //   trigger recovery: a transient error must not allow a sibling to be
  //   picked and (in config surface) later rewrite the macro XML. The
  //   `direct_fetch_status` is included in the result so callers / tests
  //   can verify the gate.
  async loadCustomContentWithOrphanRecovery(
    pageId: string | undefined,
    customContentId: string,
  ): Promise<{
    customContent: ICustomContentV2 | undefined;
    recoveredFromOrphanId?: string;
    probeResult?: Awaited<ReturnType<ApWrapper2['probeOrphanRecovery']>>;
    directFetchStatus?: 'ok' | 'not_found' | 'other_error';
  }> {
    const direct = await this.fetchCustomContentByIdV2WithStatus(customContentId);
    if (direct.status === 'ok' && direct.customContent) {
      return { customContent: direct.customContent, directFetchStatus: 'ok' };
    }
    if (direct.status !== 'not_found') {
      // Transient / 403 / 5xx / malformed — refuse to probe. Probing here
      // could surface a sibling for a CC that's only briefly unavailable
      // and (in config surface) later cause an incorrect macro XML rewrite.
      return { customContent: undefined, directFetchStatus: direct.status };
    }
    if (!pageId) {
      return { customContent: undefined, directFetchStatus: 'not_found' };
    }

    const probeResult = await this.probeOrphanRecovery(pageId, customContentId);
    // Refuse recovery when the listing was truncated: a single match on the
    // first page is not globally unambiguous if additional pages exist. Auto-
    // repair against a non-unique sibling would silently rewrite the macro XML
    // to the wrong custom content id. Surface via telemetry instead.
    if (
      probeResult.truncated ||
      probeResult.recoverable !== true ||
      probeResult.candidateCount !== 1 ||
      !probeResult.candidateIds?.[0]
    ) {
      return { customContent: undefined, probeResult, directFetchStatus: 'not_found' };
    }
    const recoveredId = probeResult.candidateIds[0];
    const recovered = await this.getCustomContentByIdV2(recoveredId);
    if (!recovered) {
      return { customContent: undefined, probeResult, directFetchStatus: 'not_found' };
    }
    return {
      customContent: recovered,
      recoveredFromOrphanId: customContentId,
      probeResult,
      directFetchStatus: 'not_found',
    };
  }

  // ZEN-1170 Defect 1 sibling: cross-page-paste recovery.
  //
  // Connect-era macros stored only {uuid, updatedAt} in macro params — no
  // `customContentId` — because the diagram body was looked up via uuid against
  // content properties. After Forge-from-Connect migration those params were
  // preserved verbatim, so any such macro that was never re-edited still has
  // no customContentId today. When the macro is then copy-pasted to a new
  // page, the destination page's macro params are a frozen {uuid, updatedAt}
  // pair AND the destination page has no zenuml-graph-macro-<uuid>-body
  // property either (content properties don't follow a macro paste) — so
  // Defect 1's content-property fallback also misses. The data however does
  // survive as a CustomContent on the SOURCE page, titled with the uuid.
  //
  // This fallback resolves the diagram by exact title match on the uuid,
  // across the legacy custom-content types. Returns the most recent matching
  // content shaped like getCustomContentByIdV2 — including cross-page copy
  // detection — so it slots into the same downstream flow.
  //
  // Confirmed reproducible 2026-05-25 on a real customer page: 27 distinct
  // CC records share one uuid title (a Connect-era save flow wrote a new
  // record each save); limit=250 fetches them all in a single page and the
  // in-memory sort by version.createdAt picks the most recent.
  async findLegacyCustomContentByUuid(uuid: string): Promise<ICustomContentV2 | undefined> {
    if (!uuid) return undefined;
    const types = forgeGlobal.isDiagramly
      ? ['gpt-custom-content-key']
      : CUSTOM_CONTENT_TYPES;
    try {
      // Use CQL exact-title search. The V2 `/api/v2/custom-content?title=...`
      // query param is silently IGNORED by the platform — verified 2026-05-27
      // on whimet4 (1000+ CCs, the matching record was beyond limit=250 and
      // never returned regardless of the title= value). The customer's case
      // (2026-05-25) only worked by luck because their 27 matching CCs all
      // landed inside the first 250 unsorted results. CQL is permission-
      // scoped server-side (a CC the user can't see won't appear) and
      // returns content metadata only — body must be fetched separately.
      const typeClause = types.map(t => `type = "${this.customContentType(t)}"`).join(' OR ');
      const cql = `(${typeClause}) AND title = "${uuid}"`;
      const search: any = await forgeRequest(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=250`);
      const ids: string[] = (search?.results || [])
        .map((r: any) => r?.content?.id)
        .filter((id: any): id is string => typeof id === 'string' && !!id);
      if (ids.length === 0) return undefined;

      // Fetch body for each candidate in parallel. N is usually 1, can be
      // higher in legacy save-creates-new-each-time scenarios (customer
      // case 2026-05-25 had 27 CCs sharing one uuid). Tolerate per-id
      // failures so one 403 doesn't poison the whole recovery.
      const bodies = await Promise.all(ids.map((id: string) =>
        this.makeRequest(`/api/v2/custom-content/${id}?body-format=raw`).catch(() => undefined),
      ));

      let best: any | undefined;
      let bestWhen = 0;
      for (const cc of bodies) {
        if (!cc || cc?.title !== uuid) continue;
        const rawValue = cc?.body?.raw?.value;
        if (!rawValue) continue;
        let parsed: any;
        try { parsed = JSON.parse(rawValue); } catch { continue; }
        if (!parsed?.diagramType) continue;
        const when = new Date(cc?.version?.createdAt || 0).getTime();
        if (!best || when > bestWhen) {
          best = cc;
          bestWhen = when;
        }
      }
      if (!best) return undefined;

      const diagram = JSON.parse(best.body.raw.value);
      diagram.source = DataSource.CustomContent;
      diagram.id = best.id;

      const currentPageId = await this._page.getPageId();
      if (currentPageId && best.pageId && String(currentPageId) !== String(best.pageId)) {
        diagram.isCopy = true;
        diagram.copyReason = 'cross-page';
        trackEvent('cross_page', 'duplication_detect', 'warning');
      } else {
        diagram.isCopy = false;
        diagram.copyReason = undefined;
      }

      return Object.assign({}, best, { value: diagram }) as ICustomContentV2;
    } catch (e: any) {
      console.error('findLegacyCustomContentByUuid', e);
      trackEvent(String(e?.message || e).substring(0, 200), 'find_legacy_custom_content_by_uuid', 'error');
      return undefined;
    }
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

  async searchCustomContent(_maxItems: number = SEARCH_CUSTOM_CONTENT_LIMIT): Promise<Array<ICustomContent>> {
    return await this.searchCustomContentForge(250);
  }

  async searchCustomContentForge(maxItems: number = 250): Promise<Array<ICustomContent>> {
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
          console.warn('Failed to parse custom content body', e);
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
    return await this.searchPagedCustomContentForge(pageSize, keyword, onlyMine, docType, ids);
  }

  async searchPagedCustomContentForge(pageSize: number = 25, keyword: string = '', onlyMine: boolean = false, docType: string = '', ids: number[] = []): Promise<SearchResults> {
    const params = new URLSearchParams();
    CUSTOM_CONTENT_TYPES.forEach(type => {
      params.append('type', this.customContentType(type));
    });
    params.append('limit', pageSize.toString());
    params.append('body-format', 'raw');
    
    if (keyword) {
      params.append('title', keyword);
    }
    
    if (onlyMine && this.currentUser?.atlassianAccountId) {
      params.append('contributor', this.currentUser.atlassianAccountId);
    }

    const searchUrl = `/wiki/api/v2/custom-content?${params.toString()}`;
    return await this.searchPagedCustomContentForgeByUrl(searchUrl);
  }

  async searchPagedCustomContentForgeByUrl(searchUrl: string, pageSize: number = 25): Promise<SearchResults> {
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
          console.warn('Failed to parse custom content body', e);
          return null;
        }
        
        diagram.source = DataSource.CustomContent;
        diagram.id = customContent.id;
        
        const assign = Object.assign({}, customContent, { value: diagram });
        return assign as ICustomContent;
      }).filter((item: ICustomContent) => item && item.value && item.value.diagramType);

      let results = parseAndFilterResponse(response);

      while(results.length < pageSize && response._links?.next) {
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
      console.log('searchPagedCustomContentForgeByUrl results:', searchResults);
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
    return await this.searchPagedCustomContentForgeByUrl(searchUrl);
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
    // ZEN-1170 Defect 2b: use status-aware fetch so the existence check
    // distinguishes a genuine 404 (legitimate "create new") from transient
    // failures (403, 5xx, malformed, thrown). Falling through to create on
    // a transient failure would orphan the user's edits when the macro
    // config still references the old CC id.
    const direct = await this.fetchCustomContentByIdV2WithStatus(customContentId);
    if (direct.status === 'other_error') {
      const err = new Error(
        `saveCustomContentV2: existence check for ${customContentId} failed: ${direct.errorDetail || 'unknown'}`,
      );
      trackEvent('save_existence_check_failed', 'save_existence_check_failed', 'error', {
        custom_content_id: customContentId,
        detail: direct.errorDetail || '',
      });
      throw err;
    }
    const existing = direct.customContent;
    const pageId = await this._getCurrentPageId();
    const count = (await this._page.countMacros((m) => {
      return m?.customContentId === customContentId //new forge custom content
        || m?.customContentId?.value === customContentId;
    }));

    // ZEN-1170: UI/control-plane fields (recoveredFromOrphan, legacyLoadBlocked,
    // migratedFromLegacyContentProperty) are set by load paths to drive viewer
    // chrome and persistence-layer behavior. They must NEVER round-trip through
    // stored CustomContent body, or every future direct fetch would parse them
    // back out and trap the (now-repaired) macro in the recovery UI forever
    // (READ-ONLY banner + disabled Edit). Strip unconditionally before any
    // create or update. Defect 1: catches legacy-content-property migrations
    // where source=ContentProperty docs flow through the create branch.
    // Defect 2b: catches the orphan-recovery branch below as well.
    const { recoveredFromOrphan: _rfo, legacyLoadBlocked: _llb, ...bodyWithoutUiFlags } = value as any;

    // ZEN-1170 Defect 2b: when the diagram was loaded via orphan-sibling
    // recovery, the macro XML still references the dead orphan id, so no
    // macro on the page references this CC yet (count === 0). We still
    // want to update this CC in-place (rather than creating a third
    // record), AND preserve body.id = orphanId so future probe-based
    // recovery still finds this CC even if the macro-config repair via
    // view.submit doesn't land. recoveredFromOrphanId itself is also
    // stripped here so future direct fetches don't re-derive the flag.
    const recoveredFromOrphanId = value.recoveredFromOrphanId;
    const samePage = !pageId || String(pageId) === String(existing?.pageId);
    // ZEN-#169: `count` comes from AtlasPage.countMacros, which reads the
    // PUBLISHED atlas_doc_format (the Forge iframe can't see the editor's
    // draft). A macro whose customContentId binding lives only in an
    // unpublished draft therefore yields count===0 even though the cc loaded
    // cleanly and lives on this page — that is a draft-only binding (or an
    // orphan), NOT a copy. Forking there mints an orphan and, in the
    // non-submittable in-viewer Edit modal, throws on the config writeback.
    // Treat count<=1 as "safe to update in place" (0 = draft-only/orphan,
    // 1 = the normal single macro). Genuine copies still fork: same-page
    // duplicates via count>1 (the else branch) and cross-page via
    // samePage===false — both are also flagged earlier as isCopy in
    // CustomContentStorageProvider.save.
    const countAllowsUpdate = count <= 1;
    let saveValue: Diagram = bodyWithoutUiFlags as Diagram;
    if (recoveredFromOrphanId) {
      const { recoveredFromOrphanId: _id, ...bodyOnly } = bodyWithoutUiFlags as any;
      saveValue = { ...bodyOnly, id: recoveredFromOrphanId } as Diagram;
    }

    if (existing && samePage && countAllowsUpdate) {
      try {
        result = await this.updateCustomContentV2(existing, saveValue);
      } catch (error) {
        trackEvent('update_custom_content_error', 'update_custom_content_error', 'error', this.buildStructuredErrorProps(error));
        throw error;
      }
    } else {
      if (count > 1) {
        console.warn(`Detected copied macro on the same page ${pageId}.`);
      }
      if (String(pageId) !== String(existing?.pageId)) {
        console.warn(`Detected copied macro on page ${pageId} (current) and ${existing?.pageId}.`);
      }
      result = await this.createCustomContentV2(saveValue);
    }
    return result;
  }

  getDialogCustomData() {
    return Promise.resolve(undefined);
  }

  isDisplayMode() {
    const modal = forgeGlobal.forgeContext?.extension?.modal;
    if (!modal) return true;
    // fullscreen is a viewer context, not an editor — still display mode
    return modal.macroMode === 'fullscreen';
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
    return {atlassianAccountId: forgeGlobal.forgeContext?.accountId};
  }

  async getCurrentSpace(): Promise<ISpace> {
    return this.currentSpace || (this.currentSpace = forgeGlobal.forgeContext?.extension?.space || {key: await this._page.getSpaceKey()});
  }

  async getCurrentSpaceAdmins(): Promise<SpaceAdmin[]> {
    return this.spaceAdminResolver.getSpaceAdmins(await this.getCurrentSpace());
  }

  async _getCurrentPageId(): Promise<string> {
    return this.currentPageId || (this.currentPageId = forgeGlobal.forgeContext?.extension?.content?.id || await this._page.getPageId());
  }

  async _getCurrentPageUrl(): Promise<string> {
    return this.currentPageUrl || (this.currentPageUrl = forgeGlobal.forgeContext?.extension?.location || await this._page.getHref());
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

  async _getLicense(): Promise<ILicense | undefined> {
    return forgeGlobal.forgeContext?.license;
  }

  async hasFullAddon(): Promise<boolean> {
    return false;
  }

  async _getLocationTarget(): Promise<LocationTarget> {
    return this.locationTarget || (this.locationTarget = await this._page.getLocationTarget());
  }

  async isInContentEditOrContentCreate(): Promise<boolean> {
    const target = await this._getLocationTarget();
    return target === LocationTarget.ContentEdit || target === LocationTarget.ContentCreate;
  }

  async canUserEdit(): Promise<boolean> {
    //TODO: check if the user has edit permission via Forge API
    return true;
  }

  isLite(): boolean {
    return forgeGlobal.isLite;
  }

  /**
   * Common request method that handles both forge and connect modes
   * @param url The API endpoint URL (without /wiki prefix)
   * @param method HTTP method (GET, POST, PUT, etc.)
   * @param data Request body data (optional)
   * @param parseFunction Optional custom parsing function for connect mode
   * @returns Parsed response data
   */
  private async makeRequest(url: string, method: string = 'GET', data: any = undefined): Promise<any> {
    return await forgeRequest(`/wiki${url}`, method, data);
  }

  async request(url: string, type: string = 'GET', data: any = undefined): Promise<any> {
    return this.makeRequest(url, type, data);
  }

  async requestAllPaginatedData(initialUrl: string, consumer: (data: any) => void): Promise<any> {
    return loadAllPaginatedData(this.request.bind(this), initialUrl, consumer);
  };

  async getAppProperty(_propertyKey: string = ''): Promise<any> {
    //TODO: Migrate the usage of AppProperty to Forge storage API
    return;
  }

  async setAppProperty(_propertyKey: string = '', _value: any = undefined): Promise<any> {
    //TODO: Migrate the usage of AppProperty to Forge storage API
    return;
  }

  async getToken(): Promise<string> {
    //TODO: Remove - this was a Connect-only method. Callers should use @forge/bridge instead.
    console.warn('getToken() is deprecated - Connect tokens are no longer available');
    return '';
  }

  async getCurrentPage(): Promise<{title: string, body: {export_view: {value: string}}} | undefined> {
    const pageId = await this._getCurrentPageId();
    return await this.request(`/api/v2/pages/${pageId}?body-format=export_view&get-draft=true`);
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
