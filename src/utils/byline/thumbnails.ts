import { attachmentNameByIdentifier } from '@/model/Attachment'

/**
 * Byline modal thumbnails.
 *
 * Every macro save already uploads a backup PNG as a page attachment named
 * `zenuml-<customContentId>.png` (see model/Attachment.ts), so a visual index
 * costs one attachment listing per open — no diagram renderers, no
 * `zenuml.esm` (3.4 MB), no Mermaid/DrawIO chunks pulled into a modal that is
 * mostly opened on pages with nothing to render.
 *
 * Two constraints shape the implementation:
 *
 * 1. **The image must be a `data:` URL.** The modal is a sandboxed Forge iframe
 *    on a different origin from the tenant, so an `<img src>` pointing at the
 *    attachment's download URL is both a CSP violation and unauthenticated.
 *    `data:` images are already proven to render in this app's Custom UI
 *    (components/GetStarted/GetStarted.vue), so bytes are fetched through the
 *    authenticated bridge and inlined.
 *
 * 2. **Everything degrades to no-thumbnail.** A diagram saved before the
 *    attachment backup existed, a PlantUML capture that failed, a viewer
 *    without attachment read permission, or a bridge Response without `blob()`
 *    all resolve to `null` and the row renders exactly as it does today. A
 *    thumbnail is decoration; the list is the feature.
 */

export interface ThumbnailRef {
  customContentId: string
  /** Site-relative path for `requestConfluence` (NOT an absolute URL — the
   *  bridge takes a path and adds authentication). */
  path: string
}

interface AttachmentLike {
  title?: string
  version?: { number?: number }
  _links?: { base?: string; download?: string }
}

/**
 * Match a page's attachments against the diagrams we are listing.
 *
 * Pure and total: unrelated attachments (user uploads, other apps' files) are
 * ignored, and an attachment with no download link is dropped rather than
 * yielding a request path that would 404. When Confluence returns several
 * versions of the same attachment, the highest version wins — mirroring
 * `tryGetAttachment`'s descending-version pick, so the thumbnail matches what
 * the page renders rather than a stale capture.
 */
export function indexThumbnails(
  attachments: Array<AttachmentLike> | null | undefined,
  customContentIds: Array<string>,
): ThumbnailRef[] {
  const wanted = new Map<string, string>() // attachment title -> customContentId
  for (const id of customContentIds || []) {
    if (id) wanted.set(attachmentNameByIdentifier(id), id)
  }
  if (wanted.size === 0) return []

  const best = new Map<string, { version: number; download: string }>()
  for (const a of attachments || []) {
    const title = a?.title
    if (!title) continue
    const id = wanted.get(title)
    if (!id) continue
    const download = a?._links?.download
    if (!download) continue
    const version = typeof a?.version?.number === 'number' ? a.version.number : 0
    const current = best.get(id)
    if (!current || version > current.version) best.set(id, { version, download })
  }

  // Preserve the caller's order so thumbnails line up with the rendered list.
  const out: ThumbnailRef[] = []
  for (const id of customContentIds || []) {
    const hit = best.get(id)
    if (hit) out.push({ customContentId: id, path: toRequestPath(hit.download) })
  }
  return out
}

/** `downloadLink` from the v2 API is site-relative and excludes the `/wiki`
 *  context path (other download-link callers in model/Attachment.ts concatenate
 *  it onto a base that already ends in `/wiki`). `requestConfluence` wants the
 *  full path. */
function toRequestPath(download: string): string {
  if (download.startsWith('/wiki/')) return download
  return `/wiki${download.startsWith('/') ? '' : '/'}${download}`
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    // FileReader rather than arrayBuffer() + btoa: matches the existing
    // blobToBase64 in model/Attachment.ts and stays jsdom-friendly in tests.
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Fetch one thumbnail's bytes through the authenticated bridge and inline them.
 * Returns null on anything unexpected — see constraint 2 in the module comment.
 */
export async function fetchThumbnailDataUrl(path: string): Promise<string | null> {
  try {
    const { requestConfluence } = await import('@forge/bridge')
    const res: any = await requestConfluence(path)
    if (!res?.ok) return null
    // The bridge's Response is fetch-shaped but binary support is not
    // documented; probe rather than assume, so an environment without blob()
    // loses thumbnails instead of throwing inside the modal.
    if (typeof res.blob !== 'function') return null
    const blob: Blob = await res.blob()
    if (!blob || !String(blob.type || '').toLowerCase().startsWith('image/')) return null
    return await blobToDataUrl(blob)
  } catch (e) {
    console.debug('[byline] thumbnail fetch failed', e)
    return null
  }
}
