import * as htmlToImage from 'html-to-image';
import md5 from 'md5';
import {trackEvent} from '@/utils/window';
import global from '@/model/globals';
import { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
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

// ============================================================================
// Helper Functions
// ============================================================================

async function getIdentifier(): Promise<string | undefined> {
  const context = await initForgeContext();
  return context?.extension?.config?.customContentId;
}

/**
 * Make requests in both Forge and Connect modes.
 * Handles multipart/form-data differently for file uploads.
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

/**
 * Generate attachment filename from identifier.
 * uuid in Connect mode, customContentId in Forge mode.
 */
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
function uploadNewVersionOfAttachment(hash: string): () => Promise<AttachmentMeta> {
  return async () => {
    const attachment = await tryGetAttachment() as AttachmentWithLinks;
    const attachmentId = attachment.id;
    const versionNumber = attachment.version.number + 1;
    trackEvent('version:' + versionNumber, 'upload_attachment', 'export');
    await uploadAttachment2(hash, (pageId: string) => {
      return buildAttachmentBasePath(pageId) + '/' + attachmentId + '/data';
    });
    return { attachmentId, versionNumber, hash };
  };
}

/**
 * Create a function that uploads a new attachment.
 */
function uploadNewAttachment(hash: string): () => Promise<AttachmentMeta> {
  return async () => {
    trackEvent('version:1', 'upload_attachment', 'export');
    const response = await uploadAttachment2(hash, buildAttachmentBasePath);
    const parsed = JSON.parse(response.body);
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
 */
async function createAttachmentIfContentChanged(content: string): Promise<void> {
  // Ensure this method will NOT be called multiple times at the same time.
  // There's an issue when diagram is edited through page edit, multiple 'diagramLoaded'
  // events are fired afterwards, thus multiple calls to this method at (almost) same time,
  // caused 409 or 503 error.
  if (window.createAttachmentInProgress) {
    return;
  }

  window.createAttachmentInProgress = true;

  try {
    const attachment = await tryGetAttachment();
    const hash = md5(content);
    if (!attachment || hash !== attachment.comment) {
      const attachmentMeta = await (attachment ? uploadNewVersionOfAttachment(hash) : uploadNewAttachment(hash))();
      await updateAttachmentProperties(attachmentMeta);
    }
  } finally {
    window.createAttachmentInProgress = false;
  }
}

export default createAttachmentIfContentChanged;
