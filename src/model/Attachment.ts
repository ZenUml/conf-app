import md5 from 'md5';
import {trackEvent} from '@/utils/window';
import { toast } from '@/utils/toast';
import global from '@/model/globals';
import forgeGlobal, { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
import {forgeRequest, callRemote} from '@/utils/requestUtil';
import {ForgeRequestError} from '@/utils/forgeRequestError';
import type { Attachment } from '@/model/ConfluenceTypes';
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';
import { recordPublishStep } from '@/utils/analytics/publishTiming';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { writePngState } from '@/lib/pngExportState.js';
import { capturePng, blobToBase64 } from '@/model/attachment/capturePng';
import {
  AttachmentUploadHttpError,
  DraftPageError,
  ToPngError,
  buildFailureLabel,
  extractHttpStatus,
} from '@/model/attachment/confluenceErrors';

// PNG capture and Confluence error parsing moved to ./attachment/*; re-exported
// here so existing importers keep working.
export { capturePng, blobToBase64 } from '@/model/attachment/capturePng';
export { extractConfluenceMessage, parseConfluenceErrorClass } from '@/model/attachment/confluenceErrors';
import { rateLimitCooldownRemainingMs, startRateLimitCooldown } from '@/utils/attachment/rateLimitCooldown';

type PngState = 'generating' | 'waiting_for_publish' | 'generation_failed' | 'upload_denied' | 'upload_failed' | 'ready';

async function recordPngState(
  pageId: string, customContentId: string, state: PngState,
  attemptId: string, startedAt: number, contentHash: string, attachmentId?: string,
  surface: 'editor' | 'viewer' = 'viewer',
  startAttempt = false,
): Promise<void> {
  try {
  const { requestConfluence } = await import('@forge/bridge');
  const reportFailure = (operation: 'read' | 'create' | 'update', error: unknown) => {
    trackAnalyticsEvent('png_export_state_persistence_failed', {
      feature_area: 'macro', surface, page_id: pageId,
      custom_content_id: customContentId, png_export_property_operation: operation,
      failure_reason: error instanceof Error ? error.message.split('_')[0] : 'unknown',
    });
  };
  const ok = await writePngState(
    (url: string, method: string, body?: unknown) => requestConfluence(url, {
      method: method as 'GET' | 'POST' | 'PUT',
      ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    }),
    { pageId, customContentId, state, attemptId, startedAt, contentHash, attachmentId, startAttempt },
    reportFailure,
  );
  if (ok) trackAnalyticsEvent('png_export_state_changed', {
    feature_area: 'macro', surface, page_id: pageId,
    custom_content_id: customContentId, png_export_state: state,
  });
  } catch (error) {
    console.warn('PNG export state write failed:', error);
  }
}

// ============================================================================
// Type Definitions
// ============================================================================


/** HTTP request configuration for Confluence API calls */
interface RequestConfig {
  url: string;
  type: 'GET' | 'POST' | 'PUT' | 'DELETE';
  contentType?: 'multipart/form-data' | 'application/json';
  data?: Record<string, unknown>;
  /**
   * JSON requests only: make a non-2xx response throw `ForgeRequestError`
   * (see `forgeRequest`) instead of returning its error body as if it were data.
   */
  throwOnHttpError?: boolean;
}

/** Metadata returned after attachment upload */
interface AttachmentMeta {
  attachmentId: string;
  versionNumber: number;
  hash: string;
}

/**
 * Where a single upload is headed. `isUpdate` distinguishes a new version of an
 * existing attachment (attachmentId + bumped versionNumber) from a brand-new
 * attachment. `uri` is the v1 POST target. Shared by the user-side upload and
 * the app-side fallback so both agree on the destination.
 */
interface UploadTarget {
  isUpdate: boolean;
  uri: string;
  attachmentId?: string;
  versionNumber: number;
}

/** Attachment with _links property (added by ApWrapper2.getAttachmentsV2) */
interface AttachmentWithLinks extends Attachment {
  _links: {
    base: string;
    download: string;
  };
  /** v1 read only (`expand=metadata`): `metadata.comment` is what v2 surfaces as `comment`. */
  metadata?: { comment?: string };
}

/** Response structure from API requests */
interface ApiResponse {
  body: string;
}

/**
 * Join keys + diagnostic context shared by every `attachment_upload_*` event.
 * Mirrors the backend `joinKeyProps()` in src/export.js so analysts can
 * left-join uploads → exports on (cloud_id, custom_content_id, page_id).
 */
interface UploadContext {
  page_id: string | undefined;
  custom_content_id: string | undefined;
  cloud_id: string | undefined;
  attachment_name: string | undefined;
  content_hash: string | undefined;
  diagram_type: string | undefined;
  /**
   * The Forge `extension.content.status` / `.type` at upload time. Recorded so
   * we can tell WHICH surface an upload fired from: the systemic `http_404`
   * class turned out to be uploads firing against an unpublished/draft parent
   * (in-editor inline preview + the pre-`view.submit` save path), where the v1
   * attachment endpoint 404s. Without these fields the failure/skip events
   * cannot distinguish a draft parent (benign) from a genuinely broken
   * published page (a real regression, `content_status === 'current'`).
   */
  content_status: string | undefined;
  content_type: string | undefined;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * The custom content this attachment belongs to.
 *
 * Resolved, not a raw `config` read: a macro placed by pasting a typed deeplink
 * has NO config at all — its id lives only in the matched URL, which Confluence
 * keeps in the page ADF. Reading config directly returned undefined for those,
 * so the guard in createAttachmentIfContentChanged bailed and the backup PNG was
 * never written on the page the macro actually sits on. That is the view-time
 * backfill the save path explicitly relies on ("the view-time path remains as a
 * backfill"), so losing it means a pasted diagram can end up with no backup at
 * all — and PDF/Word export then fails with attachment_not_found.
 *
 * Same omission as ZEN #278e3ab, which fixed the viewer/editor entry points but
 * not this one.
 */
async function getIdentifier(): Promise<string | undefined> {
  return resolveEffectiveCustomContentId(await initForgeContext());
}

/**
 * Read the cloud_id from the Forge context if it has loaded.
 * Safe to call before `initForgeContext()` resolves — returns undefined.
 */
function getCloudId(): string | undefined {
  return forgeGlobal.forgeContext?.cloudId;
}

/**
 * Read the parent content's publish status / type from the Forge context, if
 * loaded. `status` is `'current'` for a published page and `'draft'` for an
 * unpublished one; a draft (or a not-yet-`view.submit`-committed page in the
 * editor) is the parent state that makes the v1 attachment POST answer 404.
 */
function getContentStatus(): string | undefined {
  return forgeGlobal.forgeContext?.extension?.content?.status;
}

function getContentType(): string | undefined {
  return forgeGlobal.forgeContext?.extension?.content?.type;
}

/**
 * Handles multipart/form-data differently for Forge file uploads.
 */
async function makeRequest(requestConfig: RequestConfig): Promise<ApiResponse> {
  if (requestConfig.contentType === 'multipart/form-data') {
    const formData = new FormData();
    const data = requestConfig.data as Record<string, unknown>;
    Object.keys(data).forEach(key => {
      formData.append(key, data[key] as string | Blob);
    });

    const { requestConfluence } = await import("@forge/bridge");
    const response = await requestConfluence(`/wiki${requestConfig.url}`, {
      method: requestConfig.type,
      body: formData
    });
    const body = await response.text();
    // Previously this returned the body unconditionally, so a 401/403/500 from
    // Confluence flowed through as "succeeded" and only blew up later when the
    // caller tried to JSON.parse a non-JSON body (the 24% `Error` and 5%
    // `SyntaxError` events we see in `attachment_upload_failed`). Surface the
    // HTTP status as a typed error so the analytics catch can label it.
    if (!response.ok) {
      throw new AttachmentUploadHttpError(response.status, body);
    }
    return { body };
  } else {
    return requestConfig.throwOnHttpError
      ? await forgeRequest(`/wiki${requestConfig.url}`, requestConfig.type, requestConfig.data, { throwOnHttpError: true })
      : await forgeRequest(`/wiki${requestConfig.url}`, requestConfig.type, requestConfig.data);
  }
}

/**
 * Build the upload-event context once per `createAttachmentIfContentChanged`
 * invocation. Any field can be undefined if its source hasn't loaded yet —
 * the analyst should still get whatever partial context we have.
 */
async function buildUploadContext(
  contentHash: string,
  diagramType: string | undefined
): Promise<UploadContext> {
  let pageId: string | undefined;
  let customContentId: string | undefined;
  try {
    pageId = await global.apWrapper._getCurrentPageId();
  } catch {
    pageId = undefined;
  }
  try {
    customContentId = await getIdentifier();
  } catch {
    customContentId = undefined;
  }
  return {
    page_id: pageId,
    custom_content_id: customContentId,
    cloud_id: getCloudId(),
    attachment_name: customContentId ? `zenuml-${customContentId}.png` : undefined,
    content_hash: contentHash,
    diagram_type: diagramType,
    content_status: getContentStatus(),
    content_type: getContentType(),
  };
}

// ============================================================================
// Attachment Path & Request Builders
// ============================================================================

/**
 * Build the base path for attachment REST API endpoint.
 */
export function buildAttachmentBasePath(pageId: string): string {
  return '/rest/api/content/' + pageId + '/child/attachment';
}

/**
 * Build POST request config for uploading an attachment.
 */
function buildPostRequestToUploadAttachment(uri: string, hash: string, file: File): RequestConfig {
  return {
    url: uri,
    type: 'POST',
    contentType: 'multipart/form-data',
    data: { minorEdit: true, comment: hash, file: file } as unknown as Record<string, unknown>
  };
}

/**
 * Render the diagram to a PNG blob (best-effort iTXt source injection) and
 * compute the comment key actually written: if iTXt injection succeeded the
 * key carries the `|itxt:v1` suffix; otherwise it falls back to the bare
 * content hash so future views can retry.
 *
 * Extracted from the upload so the user-side POST and the app-side fallback
 * share ONE render — the fallback can't drift from what the user attempted,
 * and we don't pay for a second screen capture on the recovery path.
 */
async function renderAttachmentPng(
  hash: string,
  content?: string,
  diagramType?: string,
): Promise<{ blob: Blob; effectiveHash: string }> {
  let blob = await capturePng(diagramType, content);
  if (blob && content !== undefined && diagramType) {
    try {
      const { injectDiagramSource } = await import('@/utils/pngMetadata');
      blob = await injectDiagramSource(blob, diagramType, content);
    } catch (e) {
      console.warn('Failed to inject diagram source into PNG attachment', e);
    }
  }
  if (!blob) {
    // Show a toast only when the diagram has content — an empty diagram is already
    // surfaced by the Viewer's empty state, so no redundant message needed there.
    if (content?.trim()) {
      toast({ message: 'Diagram backup could not be saved — try re-saving.', duration: 4000 });
    }
    throw new ToPngError();
  }
  // Always store metaKey as the comment — iTXt injection is best-effort.
  // Storing the bare hash on failure causes an infinite re-upload loop when
  // toPng() consistently returns a non-PNG blob (e.g. empty diagram → 4 bytes).
  const effectiveHash = diagramType ? `${hash}|${diagramType}|itxt:v1` : hash;
  return { blob, effectiveHash };
}

/**
 * POST the rendered PNG to Confluence as the *viewing user* (the
 * `@forge/bridge.requestConfluence` path). Throws `AttachmentUploadHttpError`
 * on a non-2xx response — including the `viewer can't write` 401/403 that the
 * app-side fallback recovers (issue #166).
 */
async function postAttachmentAsUser(
  attachmentName: string,
  uri: string,
  effectiveHash: string,
  blob: Blob,
): Promise<ApiResponse> {
  const file = new File([blob], attachmentName, { type: 'image/png' });
  return await makeRequest(buildPostRequestToUploadAttachment(uri, effectiveHash, file));
}

/**
 * Build PUT request config for updating attachment properties.
 */
function buildPutRequestToUpdateAttachmentProperties(
  pageId: string,
  attachmentId: string,
  versionNumber: number,
  hash: string
): RequestConfig {
  return {
    url: buildAttachmentBasePath(pageId) + '/' + attachmentId,
    type: 'PUT',
    contentType: 'application/json',
    // A rejected PUT must not read as success (#801): a JSON 4xx/5xx body is
    // otherwise returned as data and the upload is reported as succeeded.
    throwOnHttpError: true,
    data: {
      minorEdit: true,
      id: attachmentId,
      type: 'attachment',
      version: { number: versionNumber },
      metadata: { comment: hash }
    }
  };
}

// ============================================================================
// Attachment Name & Link Functions
// ============================================================================

/**
 * The single definition of the backup-PNG filename. Exported because the byline
 * modal resolves thumbnails by matching this exact name against a page's
 * attachments (utils/byline/thumbnails.ts) — if the convention ever changes,
 * both sides must move together or thumbnails silently stop resolving.
 */
export function attachmentNameByIdentifier(id: string): string {
  return `zenuml-${id}.png`;
}

// ============================================================================
// Attachment CRUD Operations
// ============================================================================

/**
 * Resolve the host page's real status, for classifying the 404-skip bucket.
 *
 * The skip's whole justification is "the parent page isn't published yet", and
 * the event was meant to carry `content_status` so that a 404 on a *current*
 * page would stand out as a genuine regression rather than hide in the benign
 * bucket. In production that property is undefined on 100% of skipped events:
 * it comes from `forgeGlobal.forgeContext.extension.content.status`, which the
 * surfaces emitting these skips never populate — so the guard rail could not
 * fire and ~1,470 skips/5d sat in one undifferentiated bucket (#392). One v2
 * GET on the failure path (a few hundred a day, not per render) makes it real.
 *
 * Never throws. `forgeRequest` does not check `res.ok`, so a missing page comes
 * back as a v2 error envelope rather than an exception — hence the explicit
 * `errors[].status` check. Anything unresolvable degrades to 'unknown'; the
 * classification is diagnostic only and must never affect the upload outcome.
 */
async function resolvePageStatus(pageId: string | undefined): Promise<string> {
  if (!pageId) return 'unknown';
  try {
    const page = await global.apWrapper.request(`/api/v2/pages/${pageId}`);
    if (typeof page?.status === 'string' && page.status) return page.status;
    if (page?.errors?.[0]?.status === 404) return 'not_found';
    return 'unknown';
  } catch (e) {
    return extractHttpStatus(e) === 404 ? 'not_found' : 'unknown';
  }
}

/**
 * Try to get existing attachment for current macro.
 * Returns the attachment with highest version number, or false if none found.
 */
async function tryGetAttachment(identifierOverride?: string): Promise<AttachmentWithLinks | false> {
  const pageId = await global.apWrapper._getCurrentPageId();
  const identifier = identifierOverride ?? await getIdentifier();
  const attachmentName = attachmentNameByIdentifier(identifier!);
  const attachments = await global.apWrapper.getAttachmentsV2(pageId, { filename: attachmentName }) as AttachmentWithLinks[];
  const descending = attachments.sort((a, b) => (b.version?.number ?? 0) - (a.version?.number ?? 0));
  return descending.length > 0 && descending[0];
}

/** v1 answer for "a new attachment with this name already exists" (#75). */
const SAME_FILE_NAME_RE = /Cannot add a new attachment with same file name/i;

function isSameFileNameError(e: unknown): boolean {
  return e instanceof AttachmentUploadHttpError && e.status === 400 && SAME_FILE_NAME_RE.test(e.message);
}

/**
 * Re-resolve the attachment by name through the v1 API — the API the write
 * goes through — instead of v2, which is what `tryGetAttachment` gates on and
 * which just missed it (#75: v2/v1 visibility lag, or another iframe on the
 * page created the same name a moment ago). Returns the highest version, or
 * undefined when v1 does not list it either.
 */
async function findAttachmentViaV1(
  pageId: string,
  attachmentName: string,
): Promise<AttachmentWithLinks | undefined> {
  const url = `${buildAttachmentBasePath(pageId)}?filename=${encodeURIComponent(attachmentName)}&expand=version,metadata`;
  const response = await forgeRequest(`/wiki${url}`, 'GET');
  const results: AttachmentWithLinks[] = Array.isArray(response?.results) ? [...response.results] : [];
  results.sort((a, b) => (b.version?.number ?? 0) - (a.version?.number ?? 0));
  return results[0];
}

/**
 * Turn the raw upload response into AttachmentMeta, surfacing the two
 * "HTTP 200 with an error wrapped in the body" shapes the v1 API produces:
 *   - draft page:  {"statusCode":404,"message":"… status : draft"}  → DraftPageError
 *   - wrapped 4xx: {"statusCode":403, …}                            → AttachmentUploadHttpError
 * The wrapped-status check now covers BOTH the new-attachment and new-version
 * paths, so a 200-wrapped 403 on either path reaches the app fallback
 * (previously only the new-attachment path looked, so wrapped-403s on updates
 * slipped through uncaught).
 */
function parseUploadResult(
  response: ApiResponse,
  target: UploadTarget,
  effectiveHash: string,
): AttachmentMeta {
  // Parse defensively: the new-version `/data` endpoint can return a non-JSON
  // body (e.g. plain "success"), so an unparseable body just means there's no
  // wrapped error to surface — not a failure on its own.
  let parsed: any;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    parsed = undefined;
  }

  if (parsed) {
    // Option B: Confluence v1 wraps a 404 in a 200 body when the page is a draft.
    if (parsed.statusCode === 404 && String(parsed.message ?? '').includes('status : draft')) {
      throw new DraftPageError(response.body);
    }
    // Generalisation: any wrapped 4xx/5xx in a 200 body becomes a typed HTTP
    // error so the `http_<status>` label applies and the 401/403 fallback fires.
    if (typeof parsed.statusCode === 'number' && parsed.statusCode >= 400) {
      throw new AttachmentUploadHttpError(parsed.statusCode, response.body);
    }
  }

  // A new version reuses the known id + the version we're bumping to; the v1
  // `/data` response doesn't need parsing for the id.
  if (target.isUpdate) {
    return { attachmentId: target.attachmentId!, versionNumber: target.versionNumber, hash: effectiveHash };
  }

  // A brand-new attachment must yield its id from the v1 results envelope.
  const results = parsed?.results ?? parsed?.data?.results;
  if (!results?.length) {
    throw new Error(`Upload succeeded but response has no results: ${response.body}`);
  }
  return { attachmentId: results[0].id as string, versionNumber: 1, hash: effectiveHash };
}

/**
 * Recover a viewer-only 401/403 (issue #166) by re-running the COMPLETE write
 * — attachment data AND the metadata-comment PUT — server-side as the *app*,
 * via the `/forge-upload-attachment` Cloudflare remote (which receives the app
 * system token as `x-forge-oauth-system`). The app holds
 * `write:attachment:confluence`, so it succeeds where the viewer was denied.
 *
 * A backend `{ ok:false }` is surfaced as AttachmentUploadHttpError so the
 * outer analytics catch labels it `http_<status>` exactly like the direct
 * path — Mixpanel queries stay agnostic to which path produced the failure.
 */
async function uploadAttachmentViaApp(
  pageId: string,
  target: UploadTarget,
  attachmentName: string,
  effectiveHash: string,
  blob: Blob,
  opts?: { async?: boolean },
  attemptId?: string,
): Promise<AttachmentMeta> {
  const pngBase64 = await blobToBase64(blob);
  let raw: unknown;
  try {
    raw = await callRemote('/forge-upload-attachment', 'POST', {
      pageId,
      ...(target.attachmentId ? { attachmentId: target.attachmentId } : {}),
      attachmentName,
      hash: effectiveHash,
      versionNumber: target.versionNumber,
      ...(attemptId ? { pngAttemptId: attemptId } : {}),
      pngBase64,
      // Async mode: the backend acks after validation and completes the write
      // in waitUntil (survives editor teardown). See createAttachmentIfContentChanged.
      ...(opts?.async ? { async: true } : {}),
    });
  } catch (e) {
    // callRemote throws on a non-2xx transport response (e.g. the function
    // itself 500'd); normalise so the failure is labelled consistently.
    throw new AttachmentUploadHttpError(extractHttpStatus(e) ?? 0, `app fallback transport error: ${(e as Error)?.message ?? e}`);
  }
  const result: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!result?.ok) {
    throw new AttachmentUploadHttpError(
      typeof result?.status === 'number' ? result.status : 0,
      String(result?.body ?? 'app fallback failed'),
    );
  }
  // Async mode acks with { ok:true, queued:true } — the real attachmentId
  // isn't known yet (the write happens server-side after the response). Return
  // the snapshot version and an empty id; callers use this only for telemetry.
  return {
    attachmentId: String(result.attachmentId ?? target.attachmentId ?? ''),
    versionNumber: typeof result.versionNumber === 'number' ? result.versionNumber : target.versionNumber,
    hash: effectiveHash,
  };
}

/**
 * Update attachment properties (metadata) after upload.
 */
async function updateAttachmentProperties(attachmentMeta: AttachmentMeta): Promise<void> {
  const pageId = await global.apWrapper._getCurrentPageId();
  const result: any = await makeRequest(buildPutRequestToUpdateAttachmentProperties(
    pageId,
    attachmentMeta.attachmentId,
    attachmentMeta.versionNumber,
    attachmentMeta.hash
  ));
  // The v1 POST can answer HTTP 200 with the failure wrapped in the body
  // ({"statusCode":403,…}, see parseUploadResult); apply the same check to the
  // PUT's parsed body in case the v1 properties endpoint does the same. A
  // successful PUT returns the attachment object, which has no `statusCode`.
  if (typeof result?.statusCode === 'number' && result.statusCode >= 400) {
    throw new AttachmentUploadHttpError(result.statusCode, JSON.stringify(result));
  }
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Create or update attachment if diagram content has changed.
 * Uses MD5 hash to detect content changes.
 *
 * Guards against concurrent execution to prevent 409/503 errors when
 * multiple 'diagramLoaded' events fire simultaneously.
 *
 * `diagramType` is optional — when callers pass it (zenuml/mermaid/graph/openapi/embed)
 * it flows into the analytics events so we can correlate per diagram type.
 *
 * Emits the following events alongside the existing `upload_attachment`:
 *   - `attachment_upload_succeeded` (event_label: 'created' | 'updated', plus version_number)
 *   - `attachment_upload_failed`    (event_label: failure reason, plus error fields)
 * Each carries the same join keys (page_id, custom_content_id, cloud_id, ...)
 * used by the backend `macro_export_*` events in src/export.js.
 *
 * `_succeeded` gives us a denominator for computing the true upload failure rate.
 */
async function createAttachmentIfContentChanged(
  content: string,
  diagramType?: string,
  opts?: { customContentId?: string; fromSave?: boolean },
): Promise<void> {
  const hash = md5(content);
  const ctx = await buildUploadContext(hash, diagramType);
  // #212: the editor save path passes the just-saved customContentId explicitly,
  // because for a NEW macro the editor context doesn't carry it yet. When
  // provided it overrides every id source below (guard, lookup, telemetry) so
  // the attachment lands under the correct `zenuml-<id>.png` name.
  const overrideId = opts?.customContentId;
  if (overrideId) {
    ctx.custom_content_id = overrideId;
    ctx.attachment_name = `zenuml-${overrideId}.png`;
  }

  // ZEN-1170 Defect 1: central guard for legacy macros that have no
  // customContentId yet. getIdentifier() / the attachment naming chain
  // derives the filename from context.extension.config.customContentId;
  // without one, every legacy macro on every page would write/lookup
  // `zenuml-undefined.png` and collide. Skip the entire attachment write
  // — the next save migrates the macro and subsequent calls write the
  // correctly-named attachment. Centralised here so embed/swagger/other
  // viewer call sites are covered without per-caller guards.
  const macroCustomContentId = overrideId ?? resolveEffectiveCustomContentId(forgeGlobal.forgeContext);
  if (!macroCustomContentId) {
    return;
  }

  // The guard above used to do double duty. It read only
  // `extension.config.customContentId`, which is unset in a dashboard modal
  // ("My API Documents" → View/Edit — the surface forge-swagger-editor calls
  // `isDashboardEdit`), so those modals returned early as a side effect of the
  // id being empty. Widening the read to resolveEffectiveCustomContentId is
  // right for the pasted-macro case, but it also makes the id non-empty there,
  // and a dashboard modal has NO page: the upload would have nowhere to land
  // and would only produce a failing request plus attachment_upload_failed
  // noise on a path that was previously silent. Check page context explicitly,
  // so that surface still returns early for its own stated reason.
  let attachmentPageId = '';
  try {
    attachmentPageId = await global.apWrapper._getCurrentPageId();
  } catch {
    attachmentPageId = '';
  }
  if (!attachmentPageId) {
    return;
  }

  // Ensure this method will NOT be called multiple times at the same time.
  // There's an issue when diagram is edited through page edit, multiple 'diagramLoaded'
  // events are fired afterwards, thus multiple calls to this method at (almost) same time,
  // caused 409 or 503 error.
  if (window.createAttachmentInProgress) {
    return;
  }

  // Option A: skip if the page is still a draft.
  // `isDisplayMode()` in ApWrapper2 returns true for inline-preview iframes (not modal),
  // so callers fire this function before the user has published the page.
  // The v1 attachment API only accepts status=current pages — a draft page returns a
  // wrapped 404 body, causing a misleading "no results" error downstream.
  if (forgeGlobal.forgeContext?.extension?.content?.status === 'draft') {
    if (opts?.fromSave) {
      const startedAt = Date.now();
      await recordPngState(attachmentPageId, macroCustomContentId, 'waiting_for_publish',
        crypto.randomUUID(), startedAt, hash, undefined, 'editor', true);
    }
    return;
  }

  // A recent 429 on this site means Confluence is rate-limiting this user's
  // requests; a view-time backfill now would only add to them. Defer it: the
  // first view after the cooldown retries. The save-time write is a single
  // user action, so it always tries.
  const rateLimitSite = getCloudId() ?? 'unknown';
  const cooldownRemainingMs = opts?.fromSave ? 0 : rateLimitCooldownRemainingMs(rateLimitSite);
  if (cooldownRemainingMs > 0) {
    trackAnalyticsEvent('attachment_upload_deferred', {
      feature_area: 'macro', surface: 'viewer',
      page_id: ctx.page_id, custom_content_id: macroCustomContentId,
      attachment_name: ctx.attachment_name,
      cooldown_remaining_ms: cooldownRemainingMs,
    });
    return;
  }

  window.createAttachmentInProgress = true;

  // Set once the user-side write 401/403s and the app-authenticated fallback is
  // attempted. Everything recorded after that point describes the APP's write,
  // not the user's — which changes both how a 404 must be classified (see the
  // catch below) and what the recorded status means. Stamped onto
  // `attachment_upload_failed` so the two populations are separable in
  // Mixpanel instead of only recoverable by count-matching against
  // `attachment_upload_app_fallback_started` at 10% sampling (#392).
  let fallbackFromStatus: number | undefined;
  const pngAttemptId = crypto.randomUUID();
  const pngStartedAt = Date.now();
  let pngAttemptStarted = false;
  let pngCaptureCompleted = false;

  try {
    const attachment = await tryGetAttachment(overrideId);
    // metaKey encodes content, diagramType, and a version token so that:
    // (a) existing pre-iTXt attachments get one forced re-upload to backfill
    //     the embedded source chunk, and (b) type changes with same content
    //     still trigger a re-upload (diagramType in key).
    // uploadAttachment always stores metaKey as the comment (iTXt is best-effort),
    // preventing infinite re-uploads when toPng() returns a non-PNG blob.
    // When diagramType is absent injection is skipped, so no version token.
    const metaKey = diagramType ? `${hash}|${diagramType}|itxt:v1` : hash;
    if (!attachment || metaKey !== attachment.comment) {
      await recordPngState(attachmentPageId, macroCustomContentId, 'generating',
        pngAttemptId, pngStartedAt, hash, undefined, opts?.fromSave ? 'editor' : 'viewer', true);
      pngAttemptStarted = true;
      const isUpdate = Boolean(attachment);
      const pageId = await global.apWrapper._getCurrentPageId();
      const identifier = overrideId ?? await getIdentifier();
      const attachmentName = attachmentNameByIdentifier(identifier!);
      const base = buildAttachmentBasePath(pageId);
      let target: UploadTarget = isUpdate
        ? {
            isUpdate: true,
            attachmentId: (attachment as AttachmentWithLinks).id,
            versionNumber: ((attachment as AttachmentWithLinks).version?.number ?? 0) + 1,
            uri: base + '/' + (attachment as AttachmentWithLinks).id + '/data',
          }
        : { isUpdate: false, versionNumber: 1, uri: base };

      trackEvent('version:' + target.versionNumber, 'upload_attachment', 'export', ctx);

      // Render once — the same PNG bytes feed the user attempt AND the fallback.
      const captureStartedAt = performance.now();
      const { blob, effectiveHash } = await renderAttachmentPng(hash, content, diagramType);
      pngCaptureCompleted = true;
      // Publish timing: only the save-time capture is on the publish path (a
      // view-time backfill is not), and only a produced PNG is timed — a failed
      // capture throws above and records nothing.
      if (opts?.fromSave) recordPublishStep('attachment_capture_ms', captureStartedAt);

      // Save-time path (perf/publish-async-backup): the editor blocks its
      // dialog close on this write only because view.submit tears down the
      // iframe. Hand the PNG to the backend in async mode — it acks after
      // validation and finishes the Confluence POST+PUT in waitUntil, which
      // survives the teardown. So the client blocks on capture + a fast ack
      // (~1.5–3.5s) instead of capture + the full upload (~3–8s). The user is
      // the page editor here, so the app-token read-check always passes.
      if (opts?.fromSave) {
        await uploadAttachmentViaApp(pageId, target, attachmentName, effectiveHash, blob, { async: true }, pngAttemptId);
        // Not "succeeded": the write completes server-side after we return, so
        // this is a queued signal. The view-time backfill + downstream
        // macro_export_* events measure the ultimate outcome.
        trackEvent(isUpdate ? 'updated' : 'created', 'attachment_upload_queued', 'export', {
          ...ctx,
          version_number: target.versionNumber,
          from_save: true,
        });
        return;
      }

      let attachmentMeta: AttachmentMeta;
      let viaAppFallback = false;
      // Set when the create POST hit v1's "same file name" 400 and we recovered
      // by uploading a new version of the attachment v2 had missed (#75).
      let recoveredFrom: 'same_name_400' | undefined;
      // Set when the v1 re-read shows another writer already stored this exact
      // metaKey: the upload is already done, so no second version is written.
      let skippedDuplicate = false;
      // Only a denied data POST can rerun the whole write as the app.
      let stage: 'post' | 'put' = 'post';
      const postAndParse = async (t: UploadTarget): Promise<AttachmentMeta> =>
        parseUploadResult(await postAttachmentAsUser(attachmentName, t.uri, effectiveHash, blob), t, effectiveHash);
      try {
        try {
          attachmentMeta = await postAndParse(target);
        } catch (createError) {
          // The existence gate read v2 but this write is v1. If v1 already
          // holds the name, retry ONCE as a new version of it. Only the create
          // path can produce this; anything v1 can't find re-throws the
          // original error unchanged.
          if (target.isUpdate || !isSameFileNameError(createError)) throw createError;
          const existing = await findAttachmentViaV1(pageId, attachmentName).catch(() => undefined);
          if (!existing) throw createError;
          recoveredFrom = 'same_name_400';
          if (existing.metadata?.comment === metaKey) {
            // Racing iframe (#75) wrote this exact content first; uploading
            // again would add a byte-identical version. Same gate as the
            // normal path above (`metaKey !== attachment.comment`).
            skippedDuplicate = true;
            target = {
              isUpdate: true,
              attachmentId: existing.id,
              versionNumber: existing.version?.number ?? 0,
              uri: base + '/' + existing.id + '/data',
            };
            attachmentMeta = { attachmentId: existing.id, versionNumber: target.versionNumber, hash: effectiveHash };
          } else {
            target = {
              isUpdate: true,
              attachmentId: existing.id,
              versionNumber: (existing.version?.number ?? 0) + 1,
              uri: base + '/' + existing.id + '/data',
            };
            attachmentMeta = await postAndParse(target);
          }
        }
        stage = 'put';
        if (!skippedDuplicate) await updateAttachmentProperties(attachmentMeta);
      } catch (e) {
        // Viewer-only users (issue #166) lack attachment-write permission on the
        // page even though the app does. On 401/403 — whether a real HTTP status
        // or a 200-wrapped statusCode — re-run the WHOLE write (data + the
        // properties PUT) server-side as the app. Every other failure (network,
        // 5xx, parse) re-throws so we don't burn the Forge remote on cases the
        // app can't fix anyway.
        // Only a denied POST qualifies. Once the POST succeeded the attachment
        // (new) or its next version (update) already exists, so rerunning the
        // write as the app would be rejected as a duplicate name (create) or add
        // an extra version whose PUT conflicts (update). A 401/403 on the
        // properties PUT — a real HTTP status (ForgeRequestError) or a
        // 200-wrapped statusCode (AttachmentUploadHttpError) — therefore
        // re-throws and is recorded as a labelled failure instead (#801).
        if (stage === 'post' && e instanceof AttachmentUploadHttpError && (e.status === 401 || e.status === 403)) {
          fallbackFromStatus = e.status;
          // Emit BEFORE the fallback call so attempts are counted even when the
          // backend itself throws. `recovered_from_status` is the headline join.
          trackEvent(`http_${e.status}`, 'attachment_upload_app_fallback_started', 'export', {
            ...ctx,
            recovered_from_status: e.status,
          });
          attachmentMeta = await uploadAttachmentViaApp(pageId, target, attachmentName, effectiveHash, blob, undefined, pngAttemptId);
          viaAppFallback = true;
          trackEvent(`http_${e.status}`, 'attachment_upload_app_fallback_succeeded', 'export', {
            ...ctx,
            recovered_from_status: e.status,
            fallback_attachment_id: attachmentMeta.attachmentId,
          });
        } else {
          throw e;
        }
      }

      // Success path — gives us a denominator for `_failed` and tells the
      // `created` vs `updated` story. Emit only once the write (and its
      // properties PUT) really landed, whether via the user or the app path.
      trackEvent(target.isUpdate ? 'updated' : 'created', 'attachment_upload_succeeded', 'export', {
        ...ctx,
        version_number: attachmentMeta.versionNumber,
        attachment_id: attachmentMeta.attachmentId,
        via_app_fallback: viaAppFallback,
        ...(recoveredFrom ? { recovered_from: recoveredFrom } : {}),
        ...(skippedDuplicate ? { skipped_duplicate: true } : {}),
        ...(opts?.fromSave ? { from_save: true } : {}),
      });
      await recordPngState(pageId, macroCustomContentId, 'ready', pngAttemptId,
        pngStartedAt, hash, attachmentMeta.attachmentId, opts?.fromSave ? 'editor' : 'viewer');
    }
  } catch (e: any) {
    const httpStatus = extractHttpStatus(e);
    const viaAppFallback = fallbackFromStatus !== undefined;
    // 429: Confluence is rate-limiting this user. The write did not fail, it
    // was refused for now, and the next view after the cooldown retries it.
    // Start the site-wide cooldown so the other macros' backfills stand down
    // too, and record it as its own outcome rather than a failure.
    if (httpStatus === 429) {
      const cooldown = startRateLimitCooldown(
        rateLimitSite,
        e instanceof ForgeRequestError ? e.retryAfter : undefined,
      );
      if (pngAttemptStarted) await recordPngState(attachmentPageId, macroCustomContentId,
        'upload_failed', pngAttemptId, pngStartedAt, hash, undefined, opts?.fromSave ? 'editor' : 'viewer');
      trackAnalyticsEvent('attachment_upload_rate_limited', {
        feature_area: 'macro', surface: opts?.fromSave ? 'editor' : 'viewer',
        page_id: ctx.page_id, custom_content_id: macroCustomContentId,
        attachment_name: ctx.attachment_name,
        http_status: 429,
        failed_request: e instanceof ForgeRequestError ? e.endpoint
          : e instanceof AttachmentUploadHttpError ? 'POST attachment data' : 'unknown',
        retry_after_source: cooldown.source,
        ...(cooldown.retryAfterS !== undefined ? { retry_after_s: cooldown.retryAfterS } : {}),
        cooldown_ms: cooldown.cooldownMs,
      });
      return;
    }
    // A 404 on the attachment POST means the parent page is not (yet) an
    // addressable published v1 content: it's an unpublished/draft/uncommitted
    // page. This reaches us in three shapes, all of which are the SAME benign
    // situation:
    //   - DraftPageError            — 200-wrapped {"statusCode":404,… "status : draft"}
    //   - AttachmentUploadHttpError(404) via parseUploadResult — the generic
    //     200-wrapped {"statusCode":404,… "NotFoundException"} (the shape that
    //     dominates production; the narrow "status : draft" match missed it)
    //   - AttachmentUploadHttpError(404) via makeRequest — a real HTTP 404
    // The app cannot attach to a non-published parent, and the next *published*
    // view backfills the PNG, so this is NOT a hard upload failure. Counting it
    // as `http_404` mislabeled ~5k events/month (62% of mermaid's "failures"),
    // buried the real upload-failure signal, and the re-throw spammed the
    // console on every draft re-render. Record it as a low-severity skip (10%
    // sampled, see eventSampling.ts) carrying content_status/content_type so we
    // keep a denominator AND can catch a real regression.
    //
    // The benign reading holds ONLY for a 404 the *user's* write produced.
    // Once the app-authenticated fallback has run, a 404 is the app saying it
    // cannot see the page at all (a space the app isn't a member of) — the
    // dominant failure mode of the fallback, 59% of its failures per #211.
    // Skipping those buried the single most common way the fallback fails, so
    // a post-fallback 404 falls through to the genuine-failure path below and
    // is labelled `app_no_access` there (#392).
    //
    // A non-JSON 404 (ForgeRequestError) is not that situation either: it is an
    // HTML page, not Confluence's NotFound envelope, so it stays a failure.
    //
    // A JSON-status 404 (ForgeRequestError with nonJson false) can only come from
    // the properties PUT after the user's POST succeeded, so the parent exists:
    // it is not the unpublished-parent case either.
    const isForgeRequestError = e instanceof ForgeRequestError;
    const isNonJsonResponse = e instanceof ForgeRequestError && e.nonJson;
    if (e instanceof DraftPageError || (httpStatus === 404 && !viaAppFallback && !isForgeRequestError)) {
      if (pngAttemptStarted) await recordPngState(attachmentPageId, macroCustomContentId,
        'waiting_for_publish', pngAttemptId, pngStartedAt, hash, undefined, opts?.fromSave ? 'editor' : 'viewer');
      // Both branches are the 404-class skip; DraftPageError carries no numeric
      // status of its own, so normalise to 404 for a consistent denominator.
      // `content_status` is resolved from the API rather than taken from the
      // (empty) extension context, so 'current' here really does mean "the
      // parent IS published" — the regression signal this bucket promised.
      trackEvent(
        e instanceof DraftPageError ? 'draft_page' : 'unpublished_parent',
        'attachment_upload_skipped',
        'export',
        {
          ...ctx,
          http_status: httpStatus ?? 404,
          content_status: ctx.content_status ?? await resolvePageStatus(ctx.page_id),
        },
      );
      return;
    }
    // ToPngError: diagram is empty or not yet rendered. The Viewer already shows
    // an empty state for blank diagrams; for non-empty diagrams a toast was shown
    // in uploadAttachment. Either way, skip the upload — don't count as a failure.
    if (e instanceof ToPngError) {
      if (pngAttemptStarted) await recordPngState(attachmentPageId, macroCustomContentId,
        'generation_failed', pngAttemptId, pngStartedAt, hash, undefined, opts?.fromSave ? 'editor' : 'viewer');
      return;
    }
    if (pngAttemptStarted) await recordPngState(attachmentPageId, macroCustomContentId,
      !pngCaptureCompleted ? 'generation_failed' : httpStatus === 401 || httpStatus === 403 ? 'upload_denied' : 'upload_failed',
      pngAttemptId, pngStartedAt, hash, undefined, opts?.fromSave ? 'editor' : 'viewer');
    // The function still throws (callers wrap this in try/catch already), but we
    // now record the failure with full join-key context so it can be correlated
    // with the backend `macro_export_failed` event.
    //
    // event_label is the headline grouping in Mixpanel — it MUST be low
    // cardinality. Prior version emitted `e.name` which collapsed 70% of fails
    // to `UnknownError` (any non-Error throwable) and another 24% to bare
    // `Error` (anonymous `new Error(...)`), losing the HTTP status hidden in
    // the message. Use `http_<status>` when we can recover it.
    const errorName = (e instanceof Error && e.name) ? e.name : (e == null ? 'null' : typeof e);
    const errorMessage = String((e as { message?: unknown })?.message ?? e ?? '').slice(0, 200);
    const label = buildFailureLabel(e, httpStatus, viaAppFallback);
    // Explicit 'none' rather than omission — see NO_CONFLUENCE_ERROR_CLASS in
    // SnapshotAttachment.ts. An absent property cannot be told apart from an
    // unparseable class, nor from an event that predates this field.
    const confluenceErrorClass =
      (e instanceof AttachmentUploadHttpError ? e.confluenceErrorClass : undefined) || 'none';
    trackEvent(label, 'attachment_upload_failed', 'export', {
      ...ctx,
      error_name: errorName,
      error_message: errorMessage,
      http_status: httpStatus,
      via_app_fallback: viaAppFallback,
      ...(viaAppFallback ? { fallback_from_status: fallbackFromStatus } : {}),
      confluence_error_class: confluenceErrorClass,
      // ForgeRequestError only: which call got the response (the attachments GET
      // or the properties PUT). The response_* properties describe a non-JSON
      // body, so a JSON-status error (opt-in throwOnHttpError) does not carry them.
      ...(isForgeRequestError ? { failed_request: e.endpoint } : {}),
      ...(isNonJsonResponse ? {
        response_content_type: e.contentType || 'none',
        response_title: e.htmlTitle ?? 'none',
      } : {}),
    });
    throw e;
  } finally {
    window.createAttachmentInProgress = false;
  }
}

export default createAttachmentIfContentChanged;
