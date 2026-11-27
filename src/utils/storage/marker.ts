/**
 * Shared plumbing for the localStorage "marker" modules (byline unplaced
 * marker, user cohorts, paywall banner/continue attempts, staleness hint).
 *
 * Every marker is best-effort: a restrictive iframe, a full quota or a corrupt
 * value must degrade to "no marker", never to a thrown error in a render path.
 * Each module keeps its own domain logic — key prefixes, shapes, validation,
 * TTLs — and only the key building, guarded access and JSON (de)serialisation
 * live here. Key and value formats are a cross-iframe contract; do not change
 * them here.
 */

/** `prefix:part:part…`, each part `encodeURIComponent`-ed with an 'unknown'
 *  fallback, so a writer iframe and a reader iframe derive byte-identical keys. */
export function markerKey(prefix: string, ...parts: Array<string | null | undefined>): string {
  return [prefix, ...parts.map((part) => encodeURIComponent(part || 'unknown'))].join(':')
}

/** Raw string read; `null` when absent or when storage is unavailable. Never throws. */
export function readRawMarker(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Raw string write. Returns false (and reports to `onError`) on failure. Never throws. */
export function writeRawMarker(key: string, value: string, onError?: (error: unknown) => void): boolean {
  try {
    window.localStorage?.setItem(key, value)
    return true
  } catch (e) {
    onError?.(e)
    return false
  }
}

/**
 * Read and JSON-parse a marker, then hand the parsed value to `parse` to
 * validate and shape. Returns null when the key is absent, the JSON is invalid,
 * `parse` returns null, or anything throws. Never throws.
 */
export function readJsonMarker<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  const raw = readRawMarker(key)
  if (!raw) return null
  try {
    return parse(JSON.parse(raw))
  } catch {
    return null
  }
}

/** JSON-serialise and store a marker. Returns false on any failure. Never throws. */
export function writeJsonMarker(key: string, value: unknown, onError?: (error: unknown) => void): boolean {
  try {
    return writeRawMarker(key, JSON.stringify(value), onError)
  } catch (e) {
    onError?.(e)
    return false
  }
}

/** Delete a marker. Never throws. */
export function removeMarker(key: string): void {
  try {
    window.localStorage?.removeItem(key)
  } catch {
    // best-effort
  }
}
