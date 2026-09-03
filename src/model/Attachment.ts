import { captureBlob } from '@/model/captureBlob';
import md5 from 'md5';
import {trackEvent} from '@/utils/window';
import { toast } from '@/utils/toast';
import global from '@/model/globals';
import forgeGlobal, { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
import {forgeRequest, callRemote} from '@/utils/requestUtil';
import type { Attachment } from '@/model/ConfluenceTypes';
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId';

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
      }
    });

    iframe.contentWindow?.postMessage({ action: 'export' }, '*');
  });
}

/**
 * Thrown when the capture promise doesn't settle (neither resolves nor
 * rejects) within TOPNG_CAPTURE_TIMEOUT_MS. Observed on lite-stg
 * page 220659974 / custom content 220659992: `window.createAttachmentInProgress`
 * stayed true for 90+ seconds across four page loads, no `convert_to_png`
 * event ever fired (toPng's own `finally` never ran), and no attachment POST
 * reached the network — the await on toBlob() itself never returned. This
 * class exists only so toPng's catch can tag the timeout with its own
 * telemetry label, distinct from `toPng_failed` (a settled rejection). The
 * cause of that hang IS now established — html-to-image's rAF-gated
 * `createImage`, see model/captureBlob.ts — but the bound stays, so any future
 * never-settling path becomes an observed, retryable failure instead of a
 * silent permanent one.
 */
class ToPngTimeoutError extends Error {
  constructor() {
    super('toPng: html-to-image toBlob() did not settle within the capture timeout');
    this.name = 'ToPngTimeoutError';
  }
}

// Fresh graph macros on a new page wrote their attachment (full pipeline:
// bootstrap + DOM capture + upload) in ~16s (watched it run on lite-stg,
// 2026-08-19). That figure bounds the WHOLE save, not the toBlob() call in
// isolation — html-to-image's DOM screenshot is a small fraction of it, the
// rest being page bootstrap and the network upload that follows capture. So a
// 10s bound on just the capture step leaves ample margin and shouldn't cut
// off a legitimate slow capture; it only needs to be shorter than "forever".
const TOPNG_CAPTURE_TIMEOUT_MS = 10_000;

/** Race `promise` against a timeout; on timeout, reject with `makeTimeoutError()`. */
function withTimeout<T>(promise: Promise<T>, ms: number, makeTimeoutError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeTimeoutError()), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Convert diagram to PNG.
 * Uses iframe postMessage if mainFrame exists, otherwise uses html-to-image.
 */
async function toPng(): Promise<Blob | null | undefined> {
  try {
    /*
    There are 3 options:
    1) Get iframe document.body and generate png in parent frame; problem is: no style
    2) Call "toPng" method on iframe.contentWindow
    3) postMessage to iframe and receive result as message
    */
    const mainFrame = document.getElementById('mainFrame') as HTMLIFrameElement | null;
    if (mainFrame) {
      return await iframeToPng(mainFrame);
    }

    const node = document.getElementsByClassName('screen-capture-content')[0] as HTMLElement;
    // AWAIT so an *async* rejection from html-to-image is caught here. Previously
    // toPng returned the toBlob() promise directly; when html-to-image's internal
    // offscreen image fails to load (it throws a DOM `error` Event — common when
    // rasterizing a remote-server SVG like PlantUML's), that rejection escaped
    // this sync try/catch and surfaced downstream as the opaque `[object Event]`
    // / `non_error_thrown` in attachment_upload_failed (~48% of all failures).
    // Catching it here turns a capture miss into a clean ToPngError skip with
    // its own `convert_to_png` telemetry, not a mislabeled upload failure.
    //
    // Bounded with a timeout: toBlob()'s promise has been observed to never
    // settle at all (see ToPngTimeoutError) — an unbounded await here left
    // `window.createAttachmentInProgress` stuck true, silently blocking every
    // later save for that session. Racing against the timeout guarantees this
    // function always settles.
    //
    // The hang is now explained and fixed: `captureBlob` replaces
    // htmlToImage.toBlob(), whose only resolve path runs inside a
    // requestAnimationFrame callback that Chrome never services in an
    // offscreen (rendering-throttled) Forge macro iframe. See
    // model/captureBlob.ts for the measurement. The timeout stays as a bound
    // on any future never-settling path.
    return await withTimeout(
      captureBlob(node, { backgroundColor: 'white', skipFonts: true }),
      TOPNG_CAPTURE_TIMEOUT_MS,
      () => new ToPngTimeoutError(),
    );
  } catch (e) {
    console.warn('Failed to convert to png', e);
    // Timeout gets its own label so it's countable separately from other
    // convert_to_png capture failures (a settled html-to-image rejection).
    trackEvent(e instanceof ToPngTimeoutError ? 'toPng_timeout' : 'toPng_failed', 'convert_to_png', 'error');
    return undefined;
  } finally {
    trackEvent('toPng', 'convert_to_png', 'export');
  }
}

const PLANTUML_PNG_SERVER = 'https://www.plantuml.com/plantuml/png/';

/**
 * PlantUML renders by fetching an SVG from the remote PlantUML server and
 * inlining it; html-to-image then has to rasterize that inlined remote SVG to
 * make the backup PNG — and fails ~81% of the time (the offscreen image can't
 * decode the server SVG, so html-to-image rejects with a DOM Event). The server
 * already serves a ready raster at /plantuml/png/<encoded>, so fetch THAT
 * directly for the backup and skip html-to-image entirely. Deterministic, and
 * it sidesteps the single biggest class of attachment-capture failures. Returns
 * undefined on any failure so the caller falls back to the DOM capture.
 */
async function fetchPlantUmlPng(code: string): Promise<Blob | undefined> {
  try {
    const { plantumlEncode } = await import('@/utils/plantuml/encode');
    const resp = await fetch(`${PLANTUML_PNG_SERVER}${plantumlEncode(code)}`);
    if (!resp.ok) return undefined;
    const blob = await resp.blob();
    // The server can answer 200 with a non-PNG body (e.g. an HTML/SVG error
    // page from a proxy/CDN) — only accept a real raster PNG, else fall back.
    // Content-Type is reliable for the PlantUML server (image/png for PNGs).
    const type = (blob.type || '').toLowerCase().split(';')[0].trim();
    if (type !== 'image/png') return undefined;
    trackEvent('plantuml_server_png', 'convert_to_png', 'export');
    return (await upscalePlantUmlPng(blob, code)) ?? blob;
  } catch (e) {
    console.warn('PlantUML server PNG fetch failed; falling back to DOM capture', e);
    trackEvent('plantuml_server_png_failed', 'convert_to_png', 'warning');
    return undefined;
  }
}

/**
 * The PlantUML server renders at a fixed 96 dpi by default, so a small
 * diagram (few participants) comes back as a tiny raster (e.g. ~95px wide
 * for a 3-line sequence). The PDF export places every macro image at the
 * fixed content-column width (~6.3in) regardless of the source's native
 * size, so anything under `TARGET_WIDTH_PX` gets stretched ~15x and turns
 * visibly pixelated. Re-request the same diagram at a computed
 * `skinparam dpi` so the natural render is already sharp at that width —
 * see `src/utils/plantuml/resolution.ts` for why `skinparam dpi` (not the
 * `scale` directive, which plantuml.com's public server caps at 4x) is the
 * lever. Best-effort: any failure here just keeps the natural-size PNG
 * already captured by the caller.
 */
async function upscalePlantUmlPng(naturalBlob: Blob, code: string): Promise<Blob | undefined> {
  const { readPngSize, computeUpscaleDpi, withDpiDirective } = await import('@/utils/plantuml/resolution');
  const size = await readPngSize(naturalBlob);
  if (!size) return undefined;
  const dpi = computeUpscaleDpi(size.width, size.height);
  if (!dpi) return undefined;

  // withDpiDirective only matches a leading `@startuml` — if the caller's
  // content has leading whitespace (validate.ts trims before rejecting, so
  // it's storable) the injection is a no-op and the re-fetch would return
  // the same tiny PNG. Skip it rather than firing a false "upscaled" event.
  const dpiCode = withDpiDirective(code, dpi);
  if (dpiCode === code) return undefined;

  try {
    const { plantumlEncode } = await import('@/utils/plantuml/encode');
    const encoded = plantumlEncode(dpiCode);
    const resp = await fetch(`${PLANTUML_PNG_SERVER}${encoded}`);
    if (!resp.ok) {
      trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    const blob = await resp.blob();
    const type = (blob.type || '').toLowerCase().split(';')[0].trim();
    if (type !== 'image/png') {
      trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    // Confirm the server actually honoured the dpi directive before trusting
    // it as the "upscaled" result — a rejected/ignored directive would
    // otherwise report success while silently keeping the tiny image.
    const upscaledSize = await readPngSize(blob);
    if (!upscaledSize || upscaledSize.width <= size.width) {
      trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    trackEvent('plantuml_server_png_upscaled', 'convert_to_png', 'export');
    return blob;
  } catch (e) {
    console.warn('PlantUML dpi upscale fetch failed; using natural-size PNG', e);
    trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
    return undefined;
  }
}

/**
 * Produce the backup PNG for a diagram. PlantUML routes to the deterministic
 * server-side PNG fetch above (html-to-image can't reliably rasterize its
 * remote SVG); every other type captures the rendered DOM via toPng().
 */
// Exported for the byline activation dialog's completion screen (mint a
// deeplink PNG). NOTE: DOM capture is scoped to '.screen-capture-content' /
// '#mainFrame' by bare document lookups, so the diagram preview MUST still be
// mounted in the live DOM when this is called (capture at/just-after save,
// not lazily on the completion screen). Proven for sequence/mermaid/plantuml;
// graph/openapi have no snapshot node and return a non-PNG blob.
export async function capturePng(diagramType?: string, content?: string): Promise<Blob | null | undefined> {
  const trimmed = content?.trim() ?? '';
  if (diagramType === 'plantuml' && trimmed) {
    // Callers can pass a mismatched content/diagramType pair — e.g. the
    // leftover ZenUML `code` field of a doc whose type was later switched to
    // plantuml (stale diagramLoaded emit, or the embed viewer's old fallback
    // chain). Every valid PlantUML body starts with @start... (validate.ts
    // enforces @startuml before render); anything else earns a guaranteed 400
    // from the PlantUML server, so skip straight to the DOM capture.
    if (!trimmed.startsWith('@start')) {
      trackEvent('plantuml_server_png_skipped_content_mismatch', 'convert_to_png', 'warning');
    } else {
      const fetched = await fetchPlantUmlPng(content!);
      if (fetched) return fetched;
      // fall through to the DOM capture if the server fetch failed
    }
  }
  return toPng();
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
 * Convert a Blob to a base64 string (without the `data:` prefix) for shipping
 * the PNG to the backend fallback over the JSON `callRemote` wire. Uses
 * FileReader rather than `blob.arrayBuffer()` for jsdom compatibility in tests.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
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
 * The single definition of the backup-PNG filename. Exported because the byline
 * modal resolves thumbnails by matching this exact name against a page's
 * attachments (utils/byline/thumbnails.ts) — if the convention ever changes,
 * both sides must move together or thumbnails silently stop resolving.
 */
export function attachmentNameByIdentifier(id: string): string {
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
 * Thrown when toPng() returns null — the diagram is empty, not yet rendered,
 * or the capture node is absent. Treated as a skip (not a failure) so the
 * caller doesn't log it as an error and it doesn't break the save flow.
 */
class ToPngError extends Error {
  constructor() {
    super('Diagram is empty or not yet rendered — PNG capture skipped.');
    this.name = 'ToPngError';
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
  /** e.g. 'PermissionException' — undefined when the body carries no class. */
  readonly confluenceErrorClass?: string;

  constructor(public readonly status: number, body: string) {
    const detail = extractConfluenceMessage(body);
    super(`Confluence attachment API returned ${status}: ${detail.slice(0, 200)}`);
    this.name = 'AttachmentUploadHttpError';
    this.confluenceErrorClass = parseConfluenceErrorClass(detail);
  }
}

/**
 * Pull the diagnostic part out of a Confluence v1 error body.
 *
 * The v1 API wraps every error in a fixed ~180-char envelope:
 *   {"statusCode":403,"data":{"authorized":true,"valid":true,"errors":[],
 *    "successful":true},"message":"com.atlassian…Exception: <the actual reason>"}
 * Both this error's message and the `error_message` analytics property are
 * capped at 200 chars, so the envelope alone consumed the entire budget and
 * every recorded failure ended mid-class-name ("…api.BadReques"). `http_400`
 * was 21% of failures and completely undiagnosable, and JQL substring matches
 * for the exception class returned zero (#392). Keep the `message` field so
 * the 200 chars are spent on the reason instead of the wrapper.
 */
export function extractConfluenceMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // The body may be a TRUNCATED envelope — the app-fallback backend caps the
    // body it relays at 500 chars — so JSON.parse fails on an otherwise
    // well-formed prefix. Salvage the message field textually before giving up.
    const salvaged = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(body);
    if (salvaged?.[1]) return salvaged[1];
  }
  // Not a Confluence envelope: an HTML error page, a plain-text body, or one
  // of our own backend strings. Keep it as-is.
  return body;
}

/**
 * Low-cardinality Confluence exception class for grouping in Mixpanel, parsed
 * out of the fully-qualified name (`com.atlassian.…api.PermissionException:
 * …` -> `PermissionException`). Undefined when the body carries no class.
 */
export function parseConfluenceErrorClass(detail: string): string | undefined {
  return /(?:^|[.\s])([A-Za-z]+Exception)\b/.exec(detail)?.[1];
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
 *   - `app_no_access`   — the app-authenticated fallback 404'd, i.e. the APP
 *                         cannot see the page (restricted space it isn't a
 *                         member of). Distinct from a user-side `http_404`,
 *                         which means the parent page isn't published yet and
 *                         is recorded as a skip rather than a failure (#211).
 */
function buildFailureLabel(
  e: unknown,
  httpStatus: number | undefined,
  viaAppFallback = false,
): string {
  if (httpStatus === 404 && viaAppFallback) return 'app_no_access';
  if (typeof httpStatus === 'number') return `http_${httpStatus}`;
  if (e instanceof Error) return e.name || 'Error';
  return 'non_error_thrown';
}

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
      pngBase64,
      // Async mode: the backend acks after validation and completes the write
      // in waitUntil (survives editor teardown). See createAttachmentIfContentChanged.
      ...(opts?.async ? { async: true } : {}),
    });
  } catch (e) {
    // callRemote throws on a non-2xx transport response (e.g. the function
    // itself 500'd); normalise so the failure is labelled consistently.
    throw new AttachmentUploadHttpError(0, `app fallback transport error: ${(e as Error)?.message ?? e}`);
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
      const isUpdate = Boolean(attachment);
      const pageId = await global.apWrapper._getCurrentPageId();
      const identifier = overrideId ?? await getIdentifier();
      const attachmentName = attachmentNameByIdentifier(identifier!);
      const base = buildAttachmentBasePath(pageId);
      const target: UploadTarget = isUpdate
        ? {
            isUpdate: true,
            attachmentId: (attachment as AttachmentWithLinks).id,
            versionNumber: ((attachment as AttachmentWithLinks).version?.number ?? 0) + 1,
            uri: base + '/' + (attachment as AttachmentWithLinks).id + '/data',
          }
        : { isUpdate: false, versionNumber: 1, uri: base };

      trackEvent('version:' + target.versionNumber, 'upload_attachment', 'export', ctx);

      // Render once — the same PNG bytes feed the user attempt AND the fallback.
      const { blob, effectiveHash } = await renderAttachmentPng(hash, content, diagramType);

      // Save-time path (perf/publish-async-backup): the editor blocks its
      // dialog close on this write only because view.submit tears down the
      // iframe. Hand the PNG to the backend in async mode — it acks after
      // validation and finishes the Confluence POST+PUT in waitUntil, which
      // survives the teardown. So the client blocks on capture + a fast ack
      // (~1.5–3.5s) instead of capture + the full upload (~3–8s). The user is
      // the page editor here, so the app-token read-check always passes.
      if (opts?.fromSave) {
        await uploadAttachmentViaApp(pageId, target, attachmentName, effectiveHash, blob, { async: true });
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
      try {
        const response = await postAttachmentAsUser(attachmentName, target.uri, effectiveHash, blob);
        attachmentMeta = parseUploadResult(response, target, effectiveHash);
        await updateAttachmentProperties(attachmentMeta);
      } catch (e) {
        // Viewer-only users (issue #166) lack attachment-write permission on the
        // page even though the app does. On 401/403 — whether a real HTTP status
        // or a 200-wrapped statusCode — re-run the WHOLE write (data + the
        // properties PUT) server-side as the app. Every other failure (network,
        // 5xx, parse) re-throws so we don't burn the Forge remote on cases the
        // app can't fix anyway.
        if (e instanceof AttachmentUploadHttpError && (e.status === 401 || e.status === 403)) {
          fallbackFromStatus = e.status;
          // Emit BEFORE the fallback call so attempts are counted even when the
          // backend itself throws. `recovered_from_status` is the headline join.
          trackEvent(`http_${e.status}`, 'attachment_upload_app_fallback_started', 'export', {
            ...ctx,
            recovered_from_status: e.status,
          });
          attachmentMeta = await uploadAttachmentViaApp(pageId, target, attachmentName, effectiveHash, blob);
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
      trackEvent(isUpdate ? 'updated' : 'created', 'attachment_upload_succeeded', 'export', {
        ...ctx,
        version_number: attachmentMeta.versionNumber,
        attachment_id: attachmentMeta.attachmentId,
        via_app_fallback: viaAppFallback,
        ...(opts?.fromSave ? { from_save: true } : {}),
      });
    }
  } catch (e: any) {
    const httpStatus = extractHttpStatus(e);
    const viaAppFallback = fallbackFromStatus !== undefined;
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
    if (e instanceof DraftPageError || (httpStatus === 404 && !viaAppFallback)) {
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
    });
    throw e;
  } finally {
    window.createAttachmentInProgress = false;
  }
}

export default createAttachmentIfContentChanged;
