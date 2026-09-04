import { sanitizeUnplacedEntries, type UnplacedDiagramEntry } from './unplacedMarker'

/**
 * The page's unplaced-diagram set, stored as a Confluence CONTENT PROPERTY.
 *
 * This is the cross-user half of the unplaced banner. The localStorage marker
 * (unplacedMarker.ts) can only ever reach the browser that created the diagram;
 * a content property is page state, so anyone who opens the page is told — and,
 * far more importantly, Confluence itself can gate on it:
 *
 *   displayConditions:
 *     entityPropertyExists:
 *       entity: content
 *       propertyKey: zenuml-unplaced-diagrams
 *
 * That gate is evaluated SERVER-SIDE, before the module renders, so on a page
 * with no unplaced diagram the banner iframe is never created at all. It is
 * strictly cheaper than the localStorage gate it replaces, which still had to
 * boot an iframe to decide to close it. The same mechanism already gates
 * `zenuml-byline-newuser` on `zenuml-prepared-diagram` (manifest.yml).
 *
 * Verified against lite-stg on 2026-08-31 (page 243925011, since deleted):
 *
 *   POST   /wiki/api/v2/pages/{id}/properties          -> 200
 *   GET    /wiki/api/v2/pages/{id}/properties?key=...  -> 200 (results: [] when absent)
 *   PUT    /wiki/api/v2/pages/{id}/properties/{propId} -> 200 with version n+1
 *   PUT    with a stale version number                 -> 409
 *   DELETE /wiki/api/v2/pages/{id}/properties/{propId} -> 204
 *
 * and the page's own version stayed at 1 throughout — property writes leave no
 * trace in page history and do not mark the page edited.
 *
 * The write runs as the USER, not as the app. Creating custom content on a page
 * does not prove permission to edit that page's properties, so a denial is an
 * expected outcome, not a bug: `persistUnplacedProperty` reports 'forbidden'
 * and the caller falls back to the per-browser marker. `unplaced_property_write`
 * measures how often that happens in the field.
 */

/**
 * Variant-suffixed, like every other per-app key in this codebase.
 *
 * Content properties are site-global ACROSS APPS — the same fact that lets
 * Lite's byline read the `zenuml-full-active` marker Full writes (see the
 * displayConditions comment in manifest.yml). An unsuffixed key would therefore
 * let Full's banner module boot on a property Lite wrote and announce a diagram
 * it knows nothing about. Resolves to `zenuml-unplaced-diagrams-lite` on Lite
 * and `zenuml-unplaced-diagrams` elsewhere, matching
 * `zenuml-unplaced-diagrams${LITE_KEY_SUFFIX}` in the manifest — the two MUST
 * move together or the display condition silently never fires.
 */
export const UNPLACED_PROPERTY_KEY =
  import.meta.env.PRODUCT_TYPE === 'lite'
    ? 'zenuml-unplaced-diagrams-lite'
    : 'zenuml-unplaced-diagrams'

/**
 * Defensive cap on how many diagrams travel in the property. Content property
 * values have a size limit, and the banner shows a summary rather than an
 * inventory, so a pathological page (a demo page, an architecture index) has
 * nothing to gain from naming all of them. The COUNT is not capped by this —
 * the entries are — because the property's job is to arm the gate and name a
 * few, not to be the page's diagram index.
 */
export const MAX_PROPERTY_ENTRIES = 20

export interface UnplacedPropertyValue {
  entries: UnplacedDiagramEntry[]
  updatedAt: string
}

export type UnplacedPropertyRead =
  | { status: 'ok'; value: UnplacedPropertyValue; propertyId: string; version: number }
  /** Read succeeded and the key is genuinely not there — what the gate sees. */
  | { status: 'absent' }
  | { status: 'forbidden' }
  | { status: 'error' }

/**
 * 'unchanged' is a success, and a frequent one: the byline is opened repeatedly
 * on a page whose unplaced set has not moved, and rewriting the property each
 * time would bump its version for nothing.
 */
export type UnplacedPropertyWrite = 'written' | 'deleted' | 'unchanged' | 'forbidden' | 'failed'

function propertiesPath(pageId: string): string {
  return `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/properties`
}

async function request(url: string, method: string, body?: unknown) {
  const { requestConfluence } = await import('@forge/bridge')
  return requestConfluence(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function parseValue(raw: unknown): UnplacedPropertyValue | null {
  const v = raw as Partial<UnplacedPropertyValue> | undefined
  if (!v || !Array.isArray(v.entries) || typeof v.updatedAt !== 'string') return null
  return { entries: sanitizeUnplacedEntries(v.entries), updatedAt: v.updatedAt }
}

/**
 * Read the property.
 *
 * A 200 with `results: []` is 'absent' — the key is not on the page. A 404 is
 * NOT the same thing: it means the PAGE could not be reached, so we know
 * nothing, and the banner must not treat that as "no unplaced diagrams" and
 * silently delete state it never read. Same distinction ApWrapper2's
 * `getContentPropertyV2` documents for the legacy-body read.
 */
export async function readUnplacedProperty(pageId: string): Promise<UnplacedPropertyRead> {
  try {
    const res = await request(
      `${propertiesPath(pageId)}?key=${encodeURIComponent(UNPLACED_PROPERTY_KEY)}`,
      'GET',
    )
    if (res.status === 403) return { status: 'forbidden' }
    if (!res.ok) return { status: 'error' }
    const body = await res.json()
    const first = body?.results?.[0]
    if (!first) return { status: 'absent' }
    const value = parseValue(first.value)
    if (!value) return { status: 'error' }
    return {
      status: 'ok',
      value,
      propertyId: String(first.id),
      version: Number(first.version?.number) || 1,
    }
  } catch (e) {
    console.debug('[unplaced-property] read failed', e)
    return { status: 'error' }
  }
}

function sameEntries(a: UnplacedDiagramEntry[], b: UnplacedDiagramEntry[]): boolean {
  if (a.length !== b.length) return false
  const left = a.map(e => e.id).sort()
  const right = b.map(e => e.id).sort()
  return left.every((id, i) => id === right[i])
}

/**
 * Make the property say what the byline just observed.
 *
 * An EMPTY list deletes it rather than writing an empty one, because the
 * property's presence IS the display condition: an empty property would keep
 * booting a banner iframe on a page with nothing to say. Deleting it takes the
 * page back off the gate entirely.
 *
 * Never throws. Every failure is a value the caller can act on, because the
 * caller's fallback (the per-browser marker) depends on knowing which happened.
 */
export async function persistUnplacedProperty(
  pageId: string,
  entries: UnplacedDiagramEntry[],
  now: number = Date.now(),
): Promise<UnplacedPropertyWrite> {
  const current = await readUnplacedProperty(pageId)
  if (current.status === 'forbidden') return 'forbidden'
  // An unreadable property is not a licence to overwrite it: a POST would 409
  // against an existing key we simply failed to read, and a blind delete would
  // discard a set we cannot see.
  if (current.status === 'error') return 'failed'

  const capped = sanitizeUnplacedEntries(entries).slice(0, MAX_PROPERTY_ENTRIES)

  if (capped.length === 0) {
    if (current.status === 'absent') return 'unchanged'
    return deleteProperty(pageId, current.propertyId)
  }

  const value: UnplacedPropertyValue = { entries: capped, updatedAt: new Date(now).toISOString() }

  if (current.status === 'absent') {
    return writeResult(
      await request(propertiesPath(pageId), 'POST', { key: UNPLACED_PROPERTY_KEY, value }),
      'written',
    )
  }

  // The byline is opened repeatedly on pages whose unplaced set has not moved.
  // Skipping the write keeps the property's version — and its updatedAt, which
  // scopes dismissals — stable, so a user who dismissed the banner is not shown
  // it again merely because they reopened the byline.
  if (sameEntries(current.value.entries, capped)) return 'unchanged'

  const res = await request(`${propertiesPath(pageId)}/${encodeURIComponent(current.propertyId)}`, 'PUT', {
    key: UNPLACED_PROPERTY_KEY,
    version: { number: current.version + 1 },
    value,
  })
  // 409 = someone else wrote between our read and our write (measured on
  // lite-stg). Re-read and try once against the version we then see; a second
  // conflict is left alone rather than looped over.
  if (res.status === 409) {
    const fresh = await readUnplacedProperty(pageId)
    if (fresh.status !== 'ok') return 'failed'
    return writeResult(
      await request(`${propertiesPath(pageId)}/${encodeURIComponent(fresh.propertyId)}`, 'PUT', {
        key: UNPLACED_PROPERTY_KEY,
        version: { number: fresh.version + 1 },
        value,
      }),
      'written',
    )
  }
  return writeResult(res, 'written')
}

/** Take the page off the display-condition gate. */
export async function clearUnplacedProperty(pageId: string): Promise<UnplacedPropertyWrite> {
  const current = await readUnplacedProperty(pageId)
  if (current.status === 'forbidden') return 'forbidden'
  if (current.status === 'error') return 'failed'
  if (current.status === 'absent') return 'unchanged'
  return deleteProperty(pageId, current.propertyId)
}

async function deleteProperty(pageId: string, propertyId: string): Promise<UnplacedPropertyWrite> {
  try {
    const res = await request(`${propertiesPath(pageId)}/${encodeURIComponent(propertyId)}`, 'DELETE')
    if (res.status === 403) return 'forbidden'
    // 204 on success; 404 means it is already gone, which is the state we want.
    if (res.ok || res.status === 404) return 'deleted'
    return 'failed'
  } catch (e) {
    console.debug('[unplaced-property] delete failed', e)
    return 'failed'
  }
}

function writeResult(res: { ok: boolean; status: number }, success: UnplacedPropertyWrite): UnplacedPropertyWrite {
  if (res.status === 403) return 'forbidden'
  return res.ok ? success : 'failed'
}
