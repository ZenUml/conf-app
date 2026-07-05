import { OkResponse } from "./OkResponse";
import type { ForgeRequestData } from "./utils/authenticate";

// ---------------------------------------------------------------------------
// Attachment-upload fallback (issue #166)
//
// Background
// ----------
// The macro viewer (src/model/Attachment.ts) uploads the diagram-backup PNG via
// @forge/bridge.requestConfluence, which runs as the *viewing user*. ~13.8% of
// those uploads 403 because the viewer lacks attachment-write permission on the
// page — even though the app itself holds `write:attachment:confluence`. Those
// silently-missing attachments are the upstream of the bulk of
// `macro_export_failed → attachment_not_found`.
//
// This endpoint is the fallback the frontend calls ONLY when the user-side
// upload returns 401/403. It re-runs the COMPLETE write (attachment data + the
// metadata-comment PUT) as the *app* using the app system token, so the cached
// PNG lands even for viewer-only users.
//
// Why a Cloudflare remote and not a Forge resolver / web trigger
// --------------------------------------------------------------
// The macros are wired to `resolver: { endpoint: remote-connect }`, so the
// frontend has no path to a local Forge function (`api.asApp()` / web-trigger
// URLs both need a frontend→FaaS hop that the macro resolver doesn't provide).
// The existing remote already receives the app token: a Forge remote with
// `auth.appSystemToken.enabled` gets `x-forge-oauth-system` injected on every
// invocation (the sibling `x-forge-oauth-user` is what forge-custom-content.ts
// already uses). So the app-authenticated write fits the proven
// callRemote → invokeRemote → Cloudflare path with no manifest module changes.
//
// Auth / trust model
// ------------------
// 1. `/forge-upload-attachment` is in AUTHENTICATED_PATHS (functions/_middleware.ts),
//    so the request is rejected unless it carries a valid Forge invocation token
//    from this app. `data.forgeContext.apiBaseUrl` is derived from that *verified*
//    token — never from the (user-controlled) request body.
// 2. The payload's pageId/attachmentName are attacker-controllable, so before
//    writing as the app we confirm the *calling user* can read the target page
//    (GET as `x-forge-oauth-user`). This stops a user using the app's elevated
//    scope to write to pages they can't even see (confused-deputy).
// 3. attachmentName is constrained to our own `zenuml-<id>.png` namespace, the
//    PNG is size- and magic-byte-checked. We only ever write our own artifact.
//
// Wire contract (frontend → here)
//   { pageId: string, attachmentId?: string, attachmentName: string,
//     hash: string, versionNumber?: number, pngBase64: string, async?: boolean }
//   attachmentId present  → new version of an existing attachment
//   attachmentId absent   → brand-new attachment
//   async: true           → save-time fire-and-forget (see below)
//
// Response (always HTTP 200 so callRemote doesn't throw on logical failures)
//   success: { ok: true,  attachmentId: string, versionNumber: number }
//   queued:  { ok: true,  queued: true }              (async mode)
//   failure: { ok: false, status: number, body: string }
// The frontend wraps `{ ok:false }` in AttachmentUploadHttpError so the existing
// `http_<status>` analytics labels stay path-agnostic.
//
// Async mode (save-time latency, perf/publish-async-backup)
// ---------------------------------------------------------
// At editor save the frontend blocks the dialog close on the whole write
// (capture + POST + PUT ~3–8s) only because view.submit tears down the iframe
// and would abort an in-flight client-side upload. When the caller passes
// `async: true` we do the cheap synchronous validation, ACK immediately with
// `{ ok:true, queued:true }`, and finish the read-check + upload + PUT inside
// `waitUntil` — which keeps THIS worker alive past the response, so the write
// survives the client teardown. Failures are logged, not surfaced: the caller
// has already closed the editor and the view-time backfill remains the net.
// ---------------------------------------------------------------------------

// Only our own derived artifact — `zenuml-<customContentId>.png`. Rejects path
// traversal and anything outside our namespace.
const ATTACHMENT_NAME_RE = /^zenuml-[A-Za-z0-9._-]+\.png$/;
const MAX_PNG_BYTES = 5 * 1024 * 1024; // generous ceiling for a diagram screenshot
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // "\x89PNG"

function fail(status: number, body: string) {
  return OkResponse({ ok: false, status, body });
}

type UploadResult =
  | { ok: true; attachmentId: string; versionNumber: number }
  | { ok: false; status: number; body: string };

// The read-check → attachment-data POST → properties PUT, shared by the
// synchronous (401/403 fallback) and the async (save-time) modes. Returns a
// plain result object rather than a Response so the caller decides how to
// surface it (respond now, or log inside waitUntil).
async function doUpload(
  apiBaseUrl: string,
  systemToken: string,
  userToken: string,
  p: {
    pageId: string;
    attachmentId?: string;
    attachmentName: string;
    hash: string;
    versionNumber?: number;
    bytes: Uint8Array;
  },
): Promise<UploadResult> {
  // ---- authz: confirm the calling user can read the target page ----------
  // The app token can write to any page; gate on the user actually having
  // access to the content they claim to be viewing.
  //
  // Use the v2 endpoint (/api/v2/pages/{id}) — NOT the v1 /rest/api/content/{id}.
  // The v1 Confluence REST API returns 410 Gone for OAuth 2.0 tokens (the
  // x-forge-oauth-user 3LO token here), verified live on lite-stg. Every
  // working user-token path in this repo (export.js asUser, forge-custom-content)
  // uses v2 for exactly this reason.
  const pageReadUrl = `${apiBaseUrl}/api/v2/pages/${p.pageId}`;
  const readResp = await fetch(pageReadUrl, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${userToken}` },
  });
  if (!readResp.ok) {
    console.warn(`forge-upload-attachment: user read check failed (${readResp.status}) for page ${p.pageId}`);
    return { ok: false, status: 403, body: `caller cannot access page ${p.pageId} (read check ${readResp.status})` };
  }

  // ---- upload the attachment data as the app -----------------------------
  const blob = new Blob([p.bytes], { type: 'image/png' });
  const form = new FormData();
  form.append('minorEdit', 'true');
  form.append('comment', String(p.hash));
  form.append('file', blob, String(p.attachmentName));

  // v1 attachment API. apiBaseUrl is the api.atlassian.com/ex/confluence/{cloudId}
  // gateway, which proxies the /wiki context — paths are appended WITHOUT /wiki
  // (see functions/utils/confluenceUtils.ts which calls /api/v2/... the same way).
  const uploadUrl = p.attachmentId
    ? `${apiBaseUrl}/rest/api/content/${p.pageId}/child/attachment/${p.attachmentId}/data`
    : `${apiBaseUrl}/rest/api/content/${p.pageId}/child/attachment`;

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    // X-Atlassian-Token: no-check disables the XSRF check for the multipart
    // attachment endpoint. Do NOT set Content-Type — fetch derives the
    // multipart boundary from the FormData body.
    headers: { 'X-Atlassian-Token': 'no-check', Authorization: `Bearer ${systemToken}` },
    body: form,
  });
  const uploadText = await uploadResp.text();
  if (!uploadResp.ok) {
    console.warn(`forge-upload-attachment: upload ${uploadResp.status} page=${p.pageId} name=${p.attachmentName}: ${uploadText.slice(0, 200)}`);
    return { ok: false, status: uploadResp.status, body: uploadText.slice(0, 500) };
  }

  // New-attachment path: pull the id out of the v1 results envelope. For a
  // new version the frontend already knows the id, so fall back to it.
  let resolvedAttachmentId: string | null = p.attachmentId ?? null;
  try {
    const parsed = JSON.parse(uploadText);
    resolvedAttachmentId = parsed?.results?.[0]?.id ?? parsed?.data?.results?.[0]?.id ?? resolvedAttachmentId;
  } catch {
    // Non-JSON body — keep whatever id we already have.
  }
  if (!resolvedAttachmentId) {
    return { ok: false, status: 502, body: `upload succeeded but response had no attachment id: ${uploadText.slice(0, 200)}` };
  }

  // ---- mirror updateAttachmentProperties: stamp the comment as the app ----
  // Keeps end state identical to the successful user path so the frontend's
  // hash-based change detection (attachment.comment === metaKey) still skips
  // future re-uploads.
  const finalVersion = typeof p.versionNumber === 'number' && p.versionNumber > 0 ? p.versionNumber : 1;
  const putResp = await fetch(`${apiBaseUrl}/rest/api/content/${p.pageId}/child/attachment/${resolvedAttachmentId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${systemToken}`,
    },
    body: JSON.stringify({
      minorEdit: true,
      id: resolvedAttachmentId,
      type: 'attachment',
      version: { number: finalVersion },
      metadata: { comment: String(p.hash) },
    }),
  });
  if (!putResp.ok) {
    const putText = await putResp.text();
    console.warn(`forge-upload-attachment: properties PUT ${putResp.status} attachment=${resolvedAttachmentId}: ${putText.slice(0, 200)}`);
    return { ok: false, status: putResp.status, body: putText.slice(0, 500) };
  }

  return { ok: true, attachmentId: String(resolvedAttachmentId), versionNumber: finalVersion };
}

export const onRequest = async ({
  request,
  data,
  waitUntil,
}: {
  request: Request;
  data: ForgeRequestData;
  waitUntil?: (promise: Promise<any>) => void;
}) => {
  try {
    // apiBaseUrl comes from the verified invocation token (set by the auth
    // middleware), NOT the request body — this binds the write to the caller's
    // own tenant.
    const apiBaseUrl = data.forgeContext?.apiBaseUrl;
    if (!apiBaseUrl) {
      return fail(401, 'missing forge context (apiBaseUrl)');
    }

    const systemToken = request.headers.get('x-forge-oauth-system');
    const userToken = request.headers.get('x-forge-oauth-user');
    if (!systemToken) {
      return fail(401, 'missing x-forge-oauth-system header — not a valid app-token Forge request');
    }
    if (!userToken) {
      // We rely on the user token to confirm the caller can see the page before
      // writing as the app. forge-custom-content.ts requires this header too.
      return fail(401, 'missing x-forge-oauth-user header');
    }

    const body: any = await request.json();
    const { pageId, attachmentId, attachmentName, hash, versionNumber, pngBase64, async: asyncMode } = body ?? {};

    // ---- input validation (confused-deputy mitigation) --------------------
    if (!pageId || !/^[0-9]+$/.test(String(pageId))) {
      return fail(400, 'invalid pageId');
    }
    if (!attachmentName || !ATTACHMENT_NAME_RE.test(String(attachmentName))) {
      return fail(400, 'invalid attachmentName (must be zenuml-<id>.png)');
    }
    if (!hash || !pngBase64) {
      return fail(400, 'missing hash or pngBase64');
    }

    let bytes: Uint8Array;
    try {
      const binary = atob(String(pngBase64));
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      return fail(400, 'pngBase64 is not valid base64');
    }
    if (bytes.length > MAX_PNG_BYTES) {
      return fail(413, `png too large (${bytes.length} bytes)`);
    }
    if (bytes.length < 8 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) {
      return fail(400, 'payload is not a PNG');
    }

    const params = { pageId: String(pageId), attachmentId, attachmentName: String(attachmentName), hash: String(hash), versionNumber, bytes };

    // Async (save-time) mode: validation has passed, so ACK now and finish the
    // read-check + upload + PUT in waitUntil — that keeps the worker alive past
    // this response, surviving the client iframe teardown that motivates the
    // path. Failures are logged only (the editor has already closed; the
    // view-time backfill is the safety net). See the header comment.
    if (asyncMode) {
      const work = doUpload(apiBaseUrl, systemToken, userToken, params)
        .then((r) => {
          if (!r.ok) console.warn(`forge-upload-attachment[async]: ${r.status} page=${pageId} name=${attachmentName}: ${r.body.slice(0, 200)}`);
        })
        .catch((e) => console.error('forge-upload-attachment[async]: handler error', e));
      if (typeof waitUntil === 'function') {
        waitUntil(work);
      } else {
        // No waitUntil in this runtime (e.g. unit test) — await inline so the
        // upload still happens; the client already treats the ack as best-effort.
        await work;
      }
      return OkResponse({ ok: true, queued: true });
    }

    // Synchronous mode (existing 401/403 fallback): the caller is blocked on
    // the result, so run the write and surface it.
    const r = await doUpload(apiBaseUrl, systemToken, userToken, params);
    return r.ok
      ? OkResponse({ ok: true, attachmentId: r.attachmentId, versionNumber: r.versionNumber })
      : fail(r.status, r.body);
  } catch (e: any) {
    console.error('forge-upload-attachment: handler error', e);
    return fail(0, `resolver error: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 200)}`);
  }
};
