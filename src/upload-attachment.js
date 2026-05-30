import api, { route } from '@forge/api';

// ---------------------------------------------------------------------------
// Attachment-upload fallback resolver
//
// Background — issue #166
// -----------------------
// The frontend macro viewer (src/model/Attachment.ts) uploads the diagram PNG
// via @forge/bridge.requestConfluence, which runs with the *viewing user's*
// Confluence credentials. ~13.8% of those uploads currently 403 because the
// viewer lacks attachment-write permission on the page, even though the app
// itself does (`write:attachment:confluence` is declared in manifest.yml).
//
// This resolver is the **fallback** the frontend invokes ONLY when the
// user-side upload fails with 401 / 403. Almost all uploads still go direct
// frontend → Confluence to keep Forge function-call quota low; only the
// recovery cases land here.
//
// Wire contract — payload from the frontend
// -----------------------------------------
//   {
//     pageId:         string   // Confluence page id (digits)
//     attachmentId:   string?  // OMIT for new attachment, INCLUDE for new version
//     attachmentName: string   // e.g. zenuml-<customContentId>.png
//     hash:           string   // md5(diagram-content) — stored as comment so
//                              //   subsequent uploads can skip when unchanged
//     pngBase64:      string   // base64-encoded PNG bytes
//   }
//
// We deliberately receive `pageId` + optional `attachmentId` instead of the
// preformed URI. Forge's `route` tagged-template-literal requires the
// interpolated values to be passed individually so it can URL-encode them —
// receiving a pre-built path string would force regex-parsing back into its
// components, which is fragile.
//
// Wire contract — response to the frontend
// -----------------------------------------
//   success: { ok: true,  status: number, body: string, attachmentId: string|null }
//   failure: { ok: false, status: number, body: string }
//
// The frontend wraps a failure response in AttachmentUploadHttpError so the
// existing analytics catch path (#128) labels it `http_<status>` exactly like
// the direct-from-frontend path would have. Symmetry keeps Mixpanel queries
// independent of which path produced the failure.
// ---------------------------------------------------------------------------

export const handler = async (payload) => {
  const { pageId, attachmentId, attachmentName, hash, pngBase64 } = payload ?? {};

  if (!pageId || !attachmentName || !hash || !pngBase64) {
    console.warn('upload-attachment: missing required payload fields', {
      hasPageId: !!pageId,
      hasName: !!attachmentName,
      hasHash: !!hash,
      hasPng: !!pngBase64,
    });
    return { ok: false, status: 400, body: 'missing required payload fields' };
  }

  try {
    // Decode the base64 PNG → Blob. Node 22 globals; no polyfill needed.
    const binary = atob(pngBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });

    const formData = new FormData();
    formData.append('minorEdit', 'true');
    formData.append('comment', hash);
    formData.append('file', blob, attachmentName);

    // X-Atlassian-Token: no-check disables Confluence's CSRF check for the
    // app-token caller. Required by the v1 multipart attachment endpoint.
    // `route` tagged-template URL-encodes the dynamic ids — required by Forge.
    const requestOptions = {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: formData,
    };
    const response = attachmentId
      ? await api.asApp().requestConfluence(
          route`/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}/data`,
          requestOptions,
        )
      : await api.asApp().requestConfluence(
          route`/wiki/rest/api/content/${pageId}/child/attachment`,
          requestOptions,
        );

    const body = await response.text();

    if (!response.ok) {
      console.warn(
        `upload-attachment: ${response.status} for page=${pageId} attachment=${attachmentName}: ${body.slice(0, 200)}`
      );
      return { ok: false, status: response.status, body };
    }

    // Extract attachmentId for the frontend's new-attachment path
    // (uploadNewAttachment parses results[0].id from the body). For new-version
    // uploads the frontend doesn't read the id, but returning it doesn't hurt.
    // Named `newAttachmentId` to avoid shadowing the payload's `attachmentId`
    // (which only exists on the new-version-of-existing path).
    let newAttachmentId = null;
    try {
      const parsed = JSON.parse(body);
      newAttachmentId = parsed.results?.[0]?.id ?? parsed.data?.results?.[0]?.id ?? null;
    } catch {
      // Confluence sometimes returns non-JSON bodies on edge cases — that's
      // fine, the frontend will fall through its own parsing.
    }

    return { ok: true, status: response.status, body, attachmentId: newAttachmentId ?? attachmentId ?? null };
  } catch (e) {
    console.error('upload-attachment: handler error', e);
    const message = String(e?.message ?? e ?? '').slice(0, 200);
    return { ok: false, status: 0, body: `resolver error: ${e?.name ?? 'UnknownError'}: ${message}` };
  }
};
