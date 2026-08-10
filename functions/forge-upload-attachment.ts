import { OkResponse } from "./OkResponse";
import type { ForgeRequestData } from "./utils/authenticate";
import { mixpanelTrack } from "./service/mixpanelService";
import { getAtlassianInstanceClientDomain } from "./utils/dbUtils";
import type { D1Database } from "@cloudflare/workers-types";

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
// 3. attachmentName is constrained to our own `zenuml-<id>.{png,json}`
//    namespace, and the extension must agree with the declared contentType.
//    A PNG payload is additionally size- and magic-byte-checked. We only ever
//    write our own artifacts.
//
// Wire contract (frontend → here)
//   { pageId: string, attachmentId?: string, attachmentName: string,
//     hash: string, versionNumber?: number,
//     pngBase64?: string, dataBase64?: string, contentType?: string,
//     async?: boolean }
//   attachmentId present  → new version of an existing attachment
//   attachmentId absent   → brand-new attachment
//   async: true           → save-time fire-and-forget (see below)
//   contentType           → one of ALLOWED_CONTENT_TYPES; defaults to
//                            'image/png' when absent (legacy callers). Must
//                            agree with attachmentName's extension.
//   pngBase64 / dataBase64 → exactly one of these carries the base64 payload.
//                            `pngBase64` is the legacy PNG-only field, kept for
//                            backward compatibility with clients mid-rollout;
//                            `dataBase64` is the generic field new callers
//                            (e.g. the diagram-source JSON snapshot,
//                            zenuml-<ccId>.json) use, together with
//                            `contentType: 'application/json'`.
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
// survives the client teardown. Failures are not surfaced to the caller: it has
// already closed the editor and the view-time backfill remains the net.
//
// They ARE reported to Mixpanel from here, though — `attachment_upload_async_
// succeeded` / `_failed`, see reportAsyncOutcome (#392). The browser tracker
// cannot observe this write (its iframe is gone), so before that the outcome
// existed only as a console.warn and ~34% of all upload attempts had no
// success/failure signal at all.
// ---------------------------------------------------------------------------

// Only our own derived artifacts — `zenuml-<customContentId>.png` (backup
// screenshot) or `zenuml-<customContentId>.json` (diagram-source snapshot,
// docs/superpowers/plans/2026-07-18-diagram-source-snapshot-attachments.md).
// Rejects path traversal and anything outside our namespace.
const ATTACHMENT_NAME_RE = /^zenuml-[A-Za-z0-9._-]+\.(png|json)$/;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // generous ceiling for a diagram screenshot or snapshot
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // "\x89PNG"

// contentType allowlist -> the file extension it must be paired with. Keeps
// the namespace guard just as tight as the PNG-only original: a caller can't
// smuggle an arbitrary MIME type in, and can't mismatch name vs. declared type.
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'application/json': 'json',
};

function fail(status: number, body: string) {
  return OkResponse({ ok: false, status, body });
}

// Which leg of the write died. Async mode reports this as `failure_stage` —
// without it a server-side failure is a single opaque bucket, and the async
// path carries ~34% of all upload attempts (#392).
type UploadStage = 'read_check' | 'upload' | 'properties_put' | 'handler_error';

type UploadResult =
  | { ok: true; attachmentId: string; versionNumber: number }
  | { ok: false; status: number; body: string; stage: UploadStage; pageStatus?: string };

interface Env {
  MIXPANEL_TOKEN?: string;
  DB?: D1Database;
}

/**
 * Mixpanel's `client_domain` is the bare subdomain (`example-tenant`), while
 * D1 stores the full hostname (`example-tenant.atlassian.net`). Convert, so a
 * backend-emitted event lands in the same bucket as the frontend ones instead
 * of forking every tenant into two spellings.
 */
function toBareClientDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined;
  return hostname.split('.')[0] || undefined;
}

/**
 * Pull the diagnostic part out of a Confluence v1 error body.
 *
 * Mirrors `extractConfluenceMessage` in src/model/Attachment.ts — duplicated
 * rather than imported because functions/ and src/ are separate builds (the
 * same reason analyticsTypes.ts duplicates the event catalog). Keep the two in
 * sync.
 *
 * Every v1 error is wrapped in a ~180-char envelope
 * ({"statusCode":404,"data":{…},"message":"com.atlassian…"}) and this event
 * caps `failure_reason` at 200 chars, so the envelope alone consumed the whole
 * budget: verified on lite-stg, every stored reason was exactly 200 chars and
 * cut mid-sentence at "…No content found with id : Con". The frontend fixed
 * this for its own events; the backend reporter shipped without it (#392).
 */
function extractConfluenceMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // Possibly a truncated envelope (bodies are capped at 500 chars upstream),
    // so JSON.parse fails on a well-formed prefix — salvage it textually.
    const salvaged = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(body);
    if (salvaged?.[1]) return salvaged[1];
  }
  return body;
}

/**
 * Pick the event name and label for an async outcome.
 *
 * The interesting case is a 404 from the upload leg. The sync path already
 * treats that as a benign skip (`attachment_upload_skipped`) because the host
 * page usually isn't published yet, so v1 has no `current` content to attach
 * to — and #392's whole thesis is that recording that as an error destroys the
 * error signal. Shipping the async reporter without the same rule recreated
 * exactly that: on lite-stg every one of the 14 async events was a `_failed`
 * with http 404, i.e. an all-benign bucket masquerading as a 100% failure rate.
 *
 * A 404 is only benign when the page really is unpublished, so `pageStatus`
 * (from the read-check the upload already performs) decides:
 *   - not `current`  -> benign skip, the async twin of the sync 404 skip
 *   - `current`      -> the app genuinely cannot see the page (#211) ->
 *                       a real failure, labelled `app_no_access` to match the
 *                       frontend's vocabulary
 *   - unknown        -> stays a failure. Never assume benign without evidence;
 *                       `content_status: 'unknown'` makes the gap visible.
 * A 401/403 on this path stays a failure regardless — the caller is the page
 * editor, so an app-auth denial at save time is a real anomaly (the same rule
 * the snapshot path settled on in #387).
 */
function classifyAsyncOutcome(
  result: UploadResult,
): { event: 'attachment_upload_async_succeeded' | 'attachment_upload_async_failed' | 'attachment_upload_async_skipped'; label: string } {
  if (result.ok) return { event: 'attachment_upload_async_succeeded', label: 'succeeded' };
  if (result.status === 404 && result.stage === 'upload') {
    if (result.pageStatus && result.pageStatus !== 'current') {
      return { event: 'attachment_upload_async_skipped', label: 'page_not_published' };
    }
    if (result.pageStatus === 'current') {
      return { event: 'attachment_upload_async_failed', label: 'app_no_access' };
    }
  }
  return { event: 'attachment_upload_async_failed', label: `http_${result.status}` };
}

/**
 * Report the terminal outcome of an async (save-time) write.
 *
 * The whole point of async mode is that we ack before the write finishes and
 * the caller's iframe is torn down — so the browser tracker cannot report this
 * outcome, and until now nothing did: the failure path was a `console.warn`
 * inside `waitUntil`. That left ~34% of all upload attempts (1,821 of ~5,350
 * in a 5-day sample) with no success/failure signal at all, on the SAVE path
 * specifically, which is the one that matters most (#392).
 *
 * `attachment_upload_queued` (frontend, unsampled) is the denominator: every
 * queued upload should produce exactly one event here. Never throws — telemetry
 * must not be able to break a write that has already been acked.
 */
async function reportAsyncOutcome(
  env: Env | undefined,
  forgeContext: ForgeRequestData['forgeContext'],
  params: { pageId: string; attachmentName: string; contentType: string },
  result: UploadResult,
): Promise<void> {
  const token = env?.MIXPANEL_TOKEN;
  if (!token) return; // not configured (local dev / tests) — nothing to report to

  try {
    let clientDomain: string | undefined;
    if (env?.DB) {
      try {
        clientDomain = toBareClientDomain(
          await getAtlassianInstanceClientDomain(env.DB, forgeContext?.cloudId),
        );
      } catch {
        // Attribution is a nice-to-have; never lose the event over it.
      }
    }

    const outcome = classifyAsyncOutcome(result);

    await mixpanelTrack(
      {
        event: outcome.event,
        user_account_id: forgeContext?.accountId,
        feature_area: 'macro',
        surface: 'backend',
        event_category: 'export',
        // Mirrors the frontend's `event_label` grouping so the two sides of the
        // funnel break down the same way.
        event_label: outcome.label,
        page_id: params.pageId,
        attachment_name: params.attachmentName,
        content_type: params.contentType,
        cloud_id: forgeContext?.cloudId,
        client_domain: clientDomain,
        from_save: true,
        ...(result.ok
          ? { attachment_id: result.attachmentId, version_number: result.versionNumber }
          : {
              http_status: result.status,
              failure_stage: result.stage,
              // The Confluence `message`, not the envelope that used to eat the
              // entire 200-char budget.
              failure_reason: extractConfluenceMessage(result.body).slice(0, 200),
              // What made this a skip rather than a failure (or vice versa) —
              // the same guard rail the sync path carries.
              content_status: result.pageStatus ?? 'unknown',
            }),
      },
      token,
    );
  } catch (e: any) {
    console.warn('forge-upload-attachment: async outcome report failed', e?.message ?? e);
  }
}

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
    contentType: string;
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
    return { ok: false, status: 403, body: `caller cannot access page ${p.pageId} (read check ${readResp.status})`, stage: 'read_check' };
  }

  // The read-check response already carries the page's status — keep it. It is
  // the only thing that tells a benign upload 404 ("page isn't published yet",
  // so v1 has no `current` content to attach to) apart from a real one ("the
  // app cannot see this page at all", #211). Without it both are just `404`
  // and the async path cannot classify its own dominant outcome (#392).
  // Never fatal: an unreadable body leaves the status unknown, which the
  // reporter treats as a failure rather than silently assuming benign.
  let pageStatus: string | undefined;
  try {
    pageStatus = (JSON.parse(await readResp.text()) as { status?: string })?.status;
  } catch {
    pageStatus = undefined;
  }

  // ---- upload the attachment data as the app -----------------------------
  const blob = new Blob([p.bytes], { type: p.contentType });
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
    return { ok: false, status: uploadResp.status, body: uploadText.slice(0, 500), stage: 'upload', pageStatus };
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
    return { ok: false, status: 502, body: `upload succeeded but response had no attachment id: ${uploadText.slice(0, 200)}`, stage: 'upload' };
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
    return { ok: false, status: putResp.status, body: putText.slice(0, 500), stage: 'properties_put' };
  }

  return { ok: true, attachmentId: String(resolvedAttachmentId), versionNumber: finalVersion };
}

export const onRequest = async ({
  request,
  data,
  env,
  waitUntil,
}: {
  request: Request;
  data: ForgeRequestData;
  env?: Env;
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
    const {
      pageId, attachmentId, attachmentName, hash, versionNumber,
      pngBase64, dataBase64, contentType: rawContentType, async: asyncMode,
    } = body ?? {};

    // ---- input validation (confused-deputy mitigation) --------------------
    if (!pageId || !/^[0-9]+$/.test(String(pageId))) {
      return fail(400, 'invalid pageId');
    }
    if (!attachmentName || !ATTACHMENT_NAME_RE.test(String(attachmentName))) {
      return fail(400, 'invalid attachmentName (must be zenuml-<id>.png or zenuml-<id>.json)');
    }

    // contentType defaults to image/png for backward compatibility with
    // legacy callers that only ever sent a PNG and never set this field.
    const contentType = String(rawContentType ?? 'image/png');
    if (!(contentType in ALLOWED_CONTENT_TYPES)) {
      return fail(400, `invalid contentType (must be one of: ${Object.keys(ALLOWED_CONTENT_TYPES).join(', ')})`);
    }
    // The attachmentName's extension and the declared contentType must agree —
    // this is what stops "upload a PNG under a .json name" (or vice versa)
    // from smuggling the wrong bytes into the wrong-looking artifact.
    const nameExt = String(attachmentName).slice(String(attachmentName).lastIndexOf('.') + 1).toLowerCase();
    if (ALLOWED_CONTENT_TYPES[contentType] !== nameExt) {
      return fail(400, `attachmentName extension (.${nameExt}) does not match contentType (${contentType})`);
    }

    // Exactly one of the legacy `pngBase64` field and the generic `dataBase64`
    // field must carry the payload — both keeps backward compatibility with
    // in-flight Forge rollouts while giving new callers (e.g. the JSON
    // snapshot) a type-agnostic field name.
    if (dataBase64 !== undefined && pngBase64 !== undefined) {
      return fail(400, 'provide only one of dataBase64 or pngBase64');
    }
    const payloadBase64 = dataBase64 ?? pngBase64;
    if (!hash || !payloadBase64) {
      return fail(400, 'missing hash or data (pngBase64/dataBase64)');
    }

    let bytes: Uint8Array;
    try {
      const binary = atob(String(payloadBase64));
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      return fail(400, 'payload is not valid base64');
    }
    if (bytes.length > MAX_PAYLOAD_BYTES) {
      return fail(413, `payload too large (${bytes.length} bytes)`);
    }
    // Magic-byte check applies only to the PNG payload — an application/json
    // payload is arbitrary text bytes; the namespace + extension/contentType
    // consistency check above is its guard.
    if (contentType === 'image/png' && (bytes.length < 8 || !PNG_MAGIC.every((b, i) => bytes[i] === b))) {
      return fail(400, 'payload is not a PNG');
    }

    const params = {
      pageId: String(pageId), attachmentId, attachmentName: String(attachmentName),
      hash: String(hash), versionNumber, bytes, contentType,
    };

    // Async (save-time) mode: validation has passed, so ACK now and finish the
    // read-check + upload + PUT in waitUntil — that keeps the worker alive past
    // this response, surviving the client iframe teardown that motivates the
    // path. Failures are logged only (the editor has already closed; the
    // view-time backfill is the safety net). See the header comment.
    if (asyncMode) {
      const reportParams = {
        pageId: params.pageId,
        attachmentName: params.attachmentName,
        contentType,
      };
      const work = doUpload(apiBaseUrl, systemToken, userToken, params)
        .then(async (r) => {
          if (!r.ok) console.warn(`forge-upload-attachment[async]: ${r.status} page=${pageId} name=${attachmentName}: ${r.body.slice(0, 200)}`);
          // The client is gone by now, so this is the ONLY place the outcome
          // can be recorded (#392).
          await reportAsyncOutcome(env, data.forgeContext, reportParams, r);
        })
        .catch(async (e) => {
          console.error('forge-upload-attachment[async]: handler error', e);
          // A thrown handler is still an outcome — reporting only the returned
          // `{ok:false}` results would leave network/runtime errors invisible,
          // which is the exact blind spot this reporting exists to close.
          await reportAsyncOutcome(env, data.forgeContext, reportParams, {
            ok: false,
            status: 0,
            body: String(e?.message ?? e).slice(0, 200),
            stage: 'handler_error',
          });
        });
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
