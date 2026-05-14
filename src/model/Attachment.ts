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
    return { body: await response.text() };
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
 */
async function uploadAttachment(attachmentName: string, uri: string, hash: string): Promise<ApiResponse> {
  const blob = await toPng();
  const file = new File([blob!], attachmentName, { type: 'image/png' });
  console.debug('Uploading attachment to', uri);
  return await makeRequest(buildPostRequestToUploadAttachment(uri, hash, file));
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
  fnGetUri: (pageId: string) => string
): Promise<ApiResponse> {
  const pageId = await global.apWrapper._getCurrentPageId();
  const identifier = await getIdentifier();
  const attachmentName = attachmentNameByIdentifier(identifier!);
  const uri = fnGetUri(pageId);
  return await uploadAttachment(attachmentName, uri, hash);
}

/**
 * Create a function that uploads a new version of an existing attachment.
 */
function uploadNewVersionOfAttachment(hash: string, ctx: UploadContext): () => Promise<AttachmentMeta> {
  return async () => {
    const attachment = await tryGetAttachment() as AttachmentWithLinks;
    const attachmentId = attachment.id;
    const versionNumber = attachment.version.number + 1;
    trackEvent('version:' + versionNumber, 'upload_attachment', 'export', ctx);
    await uploadAttachment2(hash, (pageId: string) => {
      return buildAttachmentBasePath(pageId) + '/' + attachmentId + '/data';
    });
    return { attachmentId, versionNumber, hash };
  };
}

/**
 * Create a function that uploads a new attachment.
 */
function uploadNewAttachment(hash: string, ctx: UploadContext): () => Promise<AttachmentMeta> {
  return async () => {
    trackEvent('version:1', 'upload_attachment', 'export', ctx);
    const response = await uploadAttachment2(hash, buildAttachmentBasePath);
    const parsed = JSON.parse(response.body);
    // Option B: Confluence v1 wraps a 404 in a 200 body when the page is a draft.
    // Body: {"statusCode":404,"message":"No content found … status : draft"}
    if (parsed.statusCode === 404 && String(parsed.message ?? '').includes('status : draft')) {
      throw new DraftPageError(response.body);
    }
    const results = parsed.results ?? parsed.data?.results;
    if (!results?.length) {
      throw new Error(`Upload succeeded but response has no results: ${response.body}`);
    }
    const attachmentId = results[0].id as string;
    const versionNumber = 1;
    return { attachmentId, versionNumber, hash };
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
 *   - `attachment_upload_skipped`   (event_label: 'concurrent' | 'unchanged' | 'draft_page')
 *   - `attachment_upload_failed`    (event_label: failure reason, plus error fields)
 * Each carries the same join keys (page_id, custom_content_id, cloud_id, ...)
 * used by the backend `macro_export_*` events in src/export.js.
 */
async function createAttachmentIfContentChanged(content: string, diagramType?: string): Promise<void> {
  const hash = md5(content);
  const ctx = await buildUploadContext(hash, diagramType);

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
    if (!attachment || hash !== attachment.comment) {
      const attachmentMeta = await (attachment ? uploadNewVersionOfAttachment(hash, ctx) : uploadNewAttachment(hash, ctx))();
      await updateAttachmentProperties(attachmentMeta);
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
    const errorName = e?.name ?? 'UnknownError';
    const errorMessage = String(e?.message ?? e ?? '').slice(0, 200);
    const httpStatus = e?.xhr?.status ?? e?.status;
    trackEvent(errorName, 'attachment_upload_failed', 'export', {
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
