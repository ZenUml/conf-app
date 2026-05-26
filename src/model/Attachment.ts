import * as htmlToImage from 'html-to-image';
import md5 from 'md5';
import {trackEvent} from '@/utils/window';
import global from '@/model/globals';
import forgeGlobal, { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
import {forgeRequest} from '@/utils/requestUtil';
import type { Attachment } from '@/model/ConfluenceTypes';

// ============================================================================
// Type Definitions
// ============================================================================


/** HTTP request configuration for Confluence API calls */
interface RequestConfig {
  url: string;
  type: 'GET' | 'POST' | 'PUT' | 'DELETE';
  contentType?: 'multipart/form-data' | 'application/json';
  data?: Record<string, unknown>;
}

/** Metadata returned after attachment upload */
interface AttachmentMeta {
  attachmentId: string;
  versionNumber: number;
  hash: string;
}

/** Attachment with _links property (added by ApWrapper2.getAttachmentsV2) */
interface AttachmentWithLinks extends Attachment {
  _links: {
    base: string;
    download: string;
  };
}

/** Response structure from API requests */
interface ApiResponse {
  body: string;
}

/** Message event data for iframe PNG export */
interface ExportResultMessageData {
  action: 'export.result';
  data: Blob;
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
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getIdentifier(): Promise<string | undefined> {
  const context = await initForgeContext();
  return context?.extension?.config?.customContentId;
}

/**
 * Read the cloud_id from the Forge context if it has loaded.
 * Safe to call before `initForgeContext()` resolves — returns undefined.
 */
function getCloudId(): string | undefined {
  return forgeGlobal.forgeContext?.cloudId;
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
    return await forgeRequest(`/wiki${requestConfig.url}`, requestConfig.type, requestConfig.data);
  }
}

// ============================================================================
// PNG Generation Functions
// ============================================================================

/**
 * Convert iframe content to PNG via postMessage.
 * Sends 'export' action to iframe and waits for 'export.result' response.
 */
function iframeToPng(iframe: HTMLIFrameElement): Promise<Blob> {
  return new Promise((resolve) => {
    window.addEventListener('message', ({ source, data }: MessageEvent) => {
      const sourceWindow = source as Window | null;
      if (sourceWindow?.location?.href !== window.location.href &&
          (data as ExportResultMessageData)?.action === 'export.result') {
        resolve((data as ExportResultMessageData).data);
        console.debug('received PNG export result from iframe');
      }
    });

    iframe.contentWindow?.postMessage({ action: 'export' }, '*');
    console.debug('fired PNG export to iframe');
  });
}

/**
 * Convert diagram to PNG.
 * Uses iframe postMessage if mainFrame exists, otherwise uses html-to-image.
 */
function toPng(): Promise<Blob | null | undefined> {
  try {
    /*
    There are 3 options:
    1) Get iframe document.body and generate png in parent frame; problem is: no style
    2) Call "toPng" method on iframe.contentWindow
    3) postMessage to iframe and receive result as message
    */
    const mainFrame = document.getElementById('mainFrame') as HTMLIFrameElement | null;
    if (mainFrame) {
      return iframeToPng(mainFrame);
    }

    const node = document.getElementsByClassName('screen-capture-content')[0] as HTMLElement;
    return htmlToImage.toBlob(node, { backgroundColor: 'white', skipFonts: true });
  } catch (e) {
    console.error('Failed to convert to png', e);
    trackEvent(JSON.stringify(e), 'convert_to_png', 'error');
    return Promise.resolve(undefined);
  } finally {
    trackEvent('toPng', 'convert_to_png', 'export');
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
 * Upload an attachment file to Confluence.
 * Returns the ApiResponse and the comment key actually written: if iTXt
 * injection succeeded the key carries the `|itxt:v1` suffix; otherwise it
 * falls back to the bare content hash so future views can retry.
 */
async function uploadAttachment(
  attachmentName: string,
  uri: string,
  hash: string,
  content?: string,
  diagramType?: string,
): Promise<{ response: ApiResponse; effectiveHash: string }> {
  let blob = await toPng();
  let injectionSucceeded = false;
  if (blob && content !== undefined && diagramType) {
    try {
      const { injectDiagramSource } = await import('@/utils/pngMetadata');
      const original = blob;
      blob = await injectDiagramSource(blob, diagramType, content);
      injectionSucceeded = blob !== original;
    } catch (e) {
      console.warn('Failed to inject diagram source into PNG attachment', e);
    }
  }
  const effectiveHash = injectionSucceeded ? `${hash}|${diagramType}|itxt:v1` : hash;
  const file = new File([blob!], attachmentName, { type: 'image/png' });
  console.debug('Uploading attachment to', uri);
  const response = await makeRequest(buildPostRequestToUploadAttachment(uri, effectiveHash, file));
  return { response, effectiveHash };
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

function attachmentNameByIdentifier(id: string): string {
  return `zenuml-${id}.png`;
}

/**
 * Get the download link for an attachment by page ID and macro UUID.
 */
export async function getAttachmentDownloadLink(
  pageId: string,
  macroUuid: string
): Promise<string | false> {
  const attachmentName = attachmentNameByIdentifier(macroUuid);
  const attachments = await global.apWrapper.getAttachmentsV2(pageId, { filename: attachmentName }) as AttachmentWithLinks[];
  if (attachments.length > 1) {
    console.warn(`Multiple attachments found with uuid "${macroUuid}" on page ${pageId}:`, attachments);
  }
  return attachments.length > 0 && `${attachments[0]._links.base}${attachments[0]._links.download}`;
}

// ============================================================================
// Attachment CRUD Operations
// ============================================================================

/**
 * Thrown when the Confluence v1 attachment API rejects the upload because the
 * page is still a draft.  The API returns HTTP 200 with a body like:
 *   {"statusCode":404,"message":"No content found … status : draft"}
 * We surface this as a typed error so the outer catch can handle it without
 * re-throwing (draft pages are expected — not a bug).
 */
class DraftPageError extends Error {
  constructor(body: string) {
    super(`Attachment upload skipped — page is a draft: ${body}`);
    this.name = 'DraftPageError';
  }
}

/**
 * Thrown when the Confluence attachment API responds with a non-2xx HTTP
 * status — either reported directly on the `Response` object, or wrapped in
 * the response body (`{"statusCode": 403, ...}`).  Carrying the status as a
 * structured field lets the analytics catch label these uniformly as
 * `http_403` / `http_401` / etc. instead of opaque `Error` / `UnknownError`,
 * which made the upload-failure data unusable in Mixpanel.
 */
class AttachmentUploadHttpError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`Confluence attachment API returned ${status}: ${body.slice(0, 200)}`);
    this.name = 'AttachmentUploadHttpError';
  }
}

/**
 * Pull an HTTP status out of an arbitrary thrown value.  Covers three shapes
 * we see in production:
 *   1. `AttachmentUploadHttpError.status` (our typed error)
 *   2. `e.status` (Forge bridge surface on some failures)
 *   3. `e.xhr.status` (legacy XHR-style error)
 * Returns undefined when no status is recoverable.
 */
function extractHttpStatus(e: unknown): number | undefined {
  if (e instanceof AttachmentUploadHttpError) return e.status;
  const obj = e as { status?: unknown; xhr?: { status?: unknown } } | null | undefined;
  const candidate = obj?.status ?? obj?.xhr?.status;
  return typeof candidate === 'number' ? candidate : undefined;
}

/**
 * Build a stable, low-cardinality label for the `event_label` field on
 * `attachment_upload_failed`.  Mixpanel aggregates on this — keep it bucketed,
 * not free-form strings.  Examples:
 *   - `http_403`        — Confluence rejected the upload (permissions, etc.)
 *   - `http_404`        — page or content gone
 *   - `SyntaxError`     — body wasn't JSON (Confluence returned HTML/error page)
 *   - `non_error_thrown` — something other than an Error was thrown
 *   - `Error`           — fallback (anonymous Error with no useful name)
 */
function buildFailureLabel(e: unknown, httpStatus: number | undefined): string {
  if (typeof httpStatus === 'number') return `http_${httpStatus}`;
  if (e instanceof Error) return e.name || 'Error';
  return 'non_error_thrown';
}

/**
 * Try to get existing attachment for current macro.
 * Returns the attachment with highest version number, or false if none found.
 */
async function tryGetAttachment(): Promise<AttachmentWithLinks | false> {
  const pageId = await global.apWrapper._getCurrentPageId();
  const identifier = await getIdentifier();
  const attachmentName = attachmentNameByIdentifier(identifier!);
  const attachments = await global.apWrapper.getAttachmentsV2(pageId, { filename: attachmentName }) as AttachmentWithLinks[];
  const descending = attachments.sort((a, b) => (b.version?.number ?? 0) - (a.version?.number ?? 0));
  return descending.length > 0 && descending[0];
}

/**
 * Internal function to upload attachment with hash and URI builder.
 */
async function uploadAttachment2(
  hash: string,
  fnGetUri: (pageId: string) => string,
  content?: string,
  diagramType?: string,
): Promise<{ response: ApiResponse; effectiveHash: string }> {
  const pageId = await global.apWrapper._getCurrentPageId();
  const identifier = await getIdentifier();
  const attachmentName = attachmentNameByIdentifier(identifier!);
  const uri = fnGetUri(pageId);
  return await uploadAttachment(attachmentName, uri, hash, content, diagramType);
}

/**
 * Create a function that uploads a new version of an existing attachment.
 */
function uploadNewVersionOfAttachment(
  hash: string,
  ctx: UploadContext,
  content?: string,
  diagramType?: string,
): () => Promise<AttachmentMeta> {
  return async () => {
    const attachment = await tryGetAttachment() as AttachmentWithLinks;
    const attachmentId = attachment.id;
    const versionNumber = attachment.version.number + 1;
    trackEvent('version:' + versionNumber, 'upload_attachment', 'export', ctx);
    const { effectiveHash } = await uploadAttachment2(hash, (pageId: string) => {
      return buildAttachmentBasePath(pageId) + '/' + attachmentId + '/data';
    }, content, diagramType);
    return { attachmentId, versionNumber, hash: effectiveHash };
  };
}

/**
 * Create a function that uploads a new attachment.
 */
function uploadNewAttachment(
  hash: string,
  ctx: UploadContext,
  content?: string,
  diagramType?: string,
): () => Promise<AttachmentMeta> {
  return async () => {
    trackEvent('version:1', 'upload_attachment', 'export', ctx);
    const { response, effectiveHash } = await uploadAttachment2(hash, buildAttachmentBasePath, content, diagramType);
    const parsed = JSON.parse(response.body);
    // Option B: Confluence v1 wraps a 404 in a 200 body when the page is a draft.
    // Body: {"statusCode":404,"message":"No content found … status : draft"}
    if (parsed.statusCode === 404 && String(parsed.message ?? '').includes('status : draft')) {
      throw new DraftPageError(response.body);
    }
    // Generalisation of the above: any wrapped 4xx/5xx in a 200 body should be
    // surfaced as an HTTP error rather than falling through to the opaque
    // "no results" branch. Production logs show 403 bodies like
    //   {"statusCode":403,"data":{"authorized":true,...}}
    // which we want labelled `http_403`, not `Error`.
    if (typeof parsed.statusCode === 'number' && parsed.statusCode >= 400) {
      throw new AttachmentUploadHttpError(parsed.statusCode, response.body);
    }
    const results = parsed.results ?? parsed.data?.results;
    if (!results?.length) {
      throw new Error(`Upload succeeded but response has no results: ${response.body}`);
    }
    const attachmentId = results[0].id as string;
    const versionNumber = 1;
    return { attachmentId, versionNumber, hash: effectiveHash };
  };
}

/**
 * Update attachment properties (metadata) after upload.
 */
async function updateAttachmentProperties(attachmentMeta: AttachmentMeta): Promise<void> {
  const pageId = await global.apWrapper._getCurrentPageId();
  await makeRequest(buildPutRequestToUpdateAttachmentProperties(
    pageId,
    attachmentMeta.attachmentId,
    attachmentMeta.versionNumber,
    attachmentMeta.hash
  ));
}

/**
 * Store diagram source as a Confluence content property on the attachment.
 * This lets recovery read source via REST API without downloading the PNG binary
 * (requestConfluence from @forge/bridge returns 401 for download URLs).
 *
 * Uses the V1 content property API: /wiki/rest/api/content/{numericId}/property
 * The V2 attachment ID (att83525676) is stripped to numeric (83525676) for V1.
 */
async function setDiagramSourceProperty(attachmentId: string, diagramType: string, source: string): Promise<void> {
  const numericId = attachmentId.startsWith('att') ? attachmentId.slice(3) : attachmentId;
  const propertyKey = 'zenuml-source';
  const value = { diagramType, source };
  try {
    const existing = await forgeRequest(`/wiki/rest/api/content/${numericId}/property/${propertyKey}`).catch(() => null);
    if (existing?.version?.number != null) {
      await forgeRequest(`/wiki/rest/api/content/${numericId}/property/${propertyKey}`, 'PUT', {
        key: propertyKey,
        value,
        version: { number: existing.version.number + 1 },
      });
    } else {
      await forgeRequest(`/wiki/rest/api/content/${numericId}/property`, 'POST', {
        key: propertyKey,
        value,
      });
    }
  } catch (e) {
    console.warn('setDiagramSourceProperty failed', attachmentId, e);
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
 *   - `attachment_upload_skipped`   (event_label: 'concurrent' | 'unchanged' | 'draft_page')
 *   - `attachment_upload_failed`    (event_label: failure reason, plus error fields)
 * Each carries the same join keys (page_id, custom_content_id, cloud_id, ...)
 * used by the backend `macro_export_*` events in src/export.js.
 *
 * `_succeeded` gives us a denominator. Without it we only saw `_failed` (n=2,543/14d)
 * and `_skipped` (n=99,338/14d) — no way to compute a true upload failure rate, and
 * `_skipped(unchanged)` was a confusing proxy because it inflates with every page view.
 */
async function createAttachmentIfContentChanged(content: string, diagramType?: string): Promise<void> {
  const hash = md5(content);
  const ctx = await buildUploadContext(hash, diagramType);

  // ZEN-1170 Defect 1: central guard for legacy macros that have no
  // customContentId yet. getIdentifier() / the attachment naming chain
  // derives the filename from context.extension.config.customContentId;
  // without one, every legacy macro on every page would write/lookup
  // `zenuml-undefined.png` and collide. Skip the entire attachment write
  // — the next save migrates the macro and subsequent calls write the
  // correctly-named attachment. Centralised here so embed/swagger/other
  // viewer call sites are covered without per-caller guards.
  const macroCustomContentId = forgeGlobal.forgeContext?.extension?.config?.customContentId;
  if (!macroCustomContentId) {
    trackEvent('missing_custom_content_id', 'attachment_upload_skipped', 'export', ctx);
    return;
  }

  // Ensure this method will NOT be called multiple times at the same time.
  // There's an issue when diagram is edited through page edit, multiple 'diagramLoaded'
  // events are fired afterwards, thus multiple calls to this method at (almost) same time,
  // caused 409 or 503 error.
  if (window.createAttachmentInProgress) {
    trackEvent('concurrent', 'attachment_upload_skipped', 'export', ctx);
    return;
  }

  // Option A: skip if the page is still a draft.
  // `isDisplayMode()` in ApWrapper2 returns true for inline-preview iframes (not modal),
  // so callers fire this function before the user has published the page.
  // The v1 attachment API only accepts status=current pages — a draft page returns a
  // wrapped 404 body, causing a misleading "no results" error downstream.
  if (forgeGlobal.forgeContext?.extension?.content?.status === 'draft') {
    trackEvent('draft_page', 'attachment_upload_skipped', 'export', ctx);
    return;
  }

  window.createAttachmentInProgress = true;

  try {
    const attachment = await tryGetAttachment();
    // metaKey encodes content, diagramType, and a version token so that:
    // (a) existing pre-iTXt attachments get one forced re-upload to backfill
    //     the embedded source chunk, and (b) type changes with same content
    //     still trigger a re-upload (diagramType in key).
    // The actual comment stored is computed by uploadAttachment based on
    // whether injection succeeded — bare hash if not, metaKey if yes.
    // When diagramType is absent injection is skipped, so no version token.
    const metaKey = diagramType ? `${hash}|${diagramType}|itxt:v1` : hash;
    if (!attachment || metaKey !== attachment.comment) {
      const isUpdate = Boolean(attachment);
      const attachmentMeta = await (attachment
        ? uploadNewVersionOfAttachment(hash, ctx, content, diagramType)
        : uploadNewAttachment(hash, ctx, content, diagramType))();
      await updateAttachmentProperties(attachmentMeta);
      // Store diagram source as a Confluence content property so recovery
      // can read it via REST API without downloading the PNG binary
      // (requestConfluence from @forge/bridge returns 401 for download URLs).
      if (diagramType && content) {
        await setDiagramSourceProperty(attachmentMeta.attachmentId, diagramType, content);
      }
      // Success path — gives us a denominator for `_failed` and tells the
      // `created` vs `updated` story. Emit AFTER updateAttachmentProperties
      // so it really did land end-to-end, not just the upload POST.
      trackEvent(isUpdate ? 'updated' : 'created', 'attachment_upload_succeeded', 'export', {
        ...ctx,
        version_number: attachmentMeta.versionNumber,
        attachment_id: attachmentMeta.attachmentId,
      });
    } else {
      // Already up to date — this is the expected steady-state for an existing macro.
      // Emit so we can prove upload coverage exists when investigating `attachment_not_found`.
      trackEvent('unchanged', 'attachment_upload_skipped', 'export', ctx);
    }
  } catch (e: any) {
    // Option B: DraftPageError means the v1 API confirmed the page is a draft —
    // non-fatal, no re-throw. Emit the skip event so analysts can correlate.
    if (e instanceof DraftPageError) {
      trackEvent('draft_page', 'attachment_upload_skipped', 'export', ctx);
      return;
    }
    // The function still throws (callers wrap this in try/catch already), but we
    // now record the failure with full join-key context so it can be correlated
    // with the backend `macro_export_failed` event.
    //
    // event_label is the headline grouping in Mixpanel — it MUST be low
    // cardinality. Prior version emitted `e.name` which collapsed 70% of fails
    // to `UnknownError` (any non-Error throwable) and another 24% to bare
    // `Error` (anonymous `new Error(...)`), losing the HTTP status hidden in
    // the message. Use `http_<status>` when we can recover it.
    const httpStatus = extractHttpStatus(e);
    const errorName = (e instanceof Error && e.name) ? e.name : (e == null ? 'null' : typeof e);
    const errorMessage = String((e as { message?: unknown })?.message ?? e ?? '').slice(0, 200);
    const label = buildFailureLabel(e, httpStatus);
    trackEvent(label, 'attachment_upload_failed', 'export', {
      ...ctx,
      error_name: errorName,
      error_message: errorMessage,
      http_status: httpStatus,
    });
    throw e;
  } finally {
    window.createAttachmentInProgress = false;
  }
}

export default createAttachmentIfContentChanged;
