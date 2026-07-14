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
//     hash: string, versionNumber?: number, pngBase64: string }
//   attachmentId present  → new version of an existing attachment
//   attachmentId absent   → brand-new attachment
//
// Response (always HTTP 200 so callRemote doesn't throw on logical failures)
//   success: { ok: true,  attachmentId: string, versionNumber: number }
//   failure: { ok: false, status: number, body: string }
// The frontend wraps `{ ok:false }` in AttachmentUploadHttpError so the existing
// `http_<status>` analytics labels stay path-agnostic.
// ---------------------------------------------------------------------------

// Only our own derived artifact — `zenuml-<customContentId>.png`. Rejects path
// traversal and anything outside our namespace.
const ATTACHMENT_NAME_RE = /^zenuml-[A-Za-z0-9._-]+\.png$/;
const MAX_PNG_BYTES = 5 * 1024 * 1024; // generous ceiling for a diagram screenshot
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // "\x89PNG"

function fail(status: number, body: string) {
  return OkResponse({ ok: false, status, body });
}

export const onRequest = async ({
  request,
  data,
}: {
  request: Request;
  data: ForgeRequestData;
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
    const { pageId, attachmentId, attachmentName, hash, versionNumber, pngBase64 } = body ?? {};

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

    // ---- authz: confirm the calling user can read the target page ----------
    // The app token can write to any page; gate on the user actually having
    // access to the content they claim to be viewing.
    //
    // Use the v2 endpoint (/api/v2/pages/{id}) — NOT the v1 /rest/api/content/{id}.
    // The v1 Confluence REST API returns 410 Gone for OAuth 2.0 tokens (the
    // x-forge-oauth-user 3LO token here), verified live on lite-stg. Every
    // working user-token path in this repo (export.js asUser, forge-custom-content)
    // uses v2 for exactly this reason.
    const pageReadUrl = `${apiBaseUrl}/api/v2/pages/${pageId}`;
    const readResp = await fetch(pageReadUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${userToken}` },
    });
    if (!readResp.ok) {
      console.warn(`forge-upload-attachment: user read check failed (${readResp.status}) for page ${pageId}`);
      return fail(403, `caller cannot access page ${pageId} (read check ${readResp.status})`);
    }

    // ---- efficiency: skip the write if the APP can't even access the page ---
    // Issue #211: production data showed ~59% of triggered fallbacks fail with
    // 404 NotFoundException because the app principal isn't a member of the
    // page's (restricted) space — it can't see the page at all. The user-read
    // check above can't catch this (it validates the *user*, who can read).
    // A cheap app-side GET lets us skip building/sending the multipart upload
    // for those cases: a GET that 404s is far cheaper than a multipart POST
    // that 404s, and yields a clear `app_no_access` signal instead of a
    // confusing NotFoundException on the write. (This does NOT pre-empt the
    // ~34% PermissionException case — the app can read but not write there;
    // that can only be discovered by attempting the write.)
    const appReadResp = await fetch(pageReadUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${systemToken}` },
    });
    if (!appReadResp.ok) {
      console.warn(`forge-upload-attachment: app cannot access page ${pageId} (${appReadResp.status}) — skipping write`);
      return fail(appReadResp.status, `app_no_access: app cannot access page ${pageId} (${appReadResp.status})`);
    }

    // ---- upload the attachment data as the app -----------------------------
    const blob = new Blob([bytes], { type: 'image/png' });
    const form = new FormData();
    form.append('minorEdit', 'true');
    form.append('comment', String(hash));
    form.append('file', blob, String(attachmentName));

    // v1 attachment API. apiBaseUrl is the api.atlassian.com/ex/confluence/{cloudId}
    // gateway, which proxies the /wiki context — paths are appended WITHOUT /wiki
    // (see functions/utils/confluenceUtils.ts which calls /api/v2/... the same way).
    const uploadUrl = attachmentId
      ? `${apiBaseUrl}/rest/api/content/${pageId}/child/attachment/${attachmentId}/data`
      : `${apiBaseUrl}/rest/api/content/${pageId}/child/attachment`;

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
      console.warn(`forge-upload-attachment: upload ${uploadResp.status} page=${pageId} name=${attachmentName}: ${uploadText.slice(0, 200)}`);
      return fail(uploadResp.status, uploadText.slice(0, 500));
    }

    // New-attachment path: pull the id out of the v1 results envelope. For a
    // new version the frontend already knows the id, so fall back to it.
    let resolvedAttachmentId: string | null = attachmentId ?? null;
    try {
      const parsed = JSON.parse(uploadText);
      resolvedAttachmentId = parsed?.results?.[0]?.id ?? parsed?.data?.results?.[0]?.id ?? resolvedAttachmentId;
    } catch {
      // Non-JSON body — keep whatever id we already have.
    }
    if (!resolvedAttachmentId) {
      return fail(502, `upload succeeded but response had no attachment id: ${uploadText.slice(0, 200)}`);
    }

    // ---- mirror updateAttachmentProperties: stamp the comment as the app ----
    // Keeps end state identical to the successful user path so the frontend's
    // hash-based change detection (attachment.comment === metaKey) still skips
    // future re-uploads.
    const finalVersion = typeof versionNumber === 'number' && versionNumber > 0 ? versionNumber : 1;
    const putResp = await fetch(`${apiBaseUrl}/rest/api/content/${pageId}/child/attachment/${resolvedAttachmentId}`, {
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
        metadata: { comment: String(hash) },
      }),
    });
    if (!putResp.ok) {
      const putText = await putResp.text();
      console.warn(`forge-upload-attachment: properties PUT ${putResp.status} attachment=${resolvedAttachmentId}: ${putText.slice(0, 200)}`);
      return fail(putResp.status, putText.slice(0, 500));
    }

    return OkResponse({ ok: true, attachmentId: String(resolvedAttachmentId), versionNumber: finalVersion });
  } catch (e: any) {
    console.error('forge-upload-attachment: handler error', e);
    return fail(0, `resolver error: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 200)}`);
  }
};
