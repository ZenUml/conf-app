/**
 * WebSocket admission policy, adapted from TemPad Dev's security.ts (MIT,
 * Baidu EFE team; see THIRD_PARTY_NOTICES.md). Loopback bind + extension
 * Origin + fixed path; no pairing token by decision (2026-10-23).
 */
export const CHROME_EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/

export interface ExtensionOriginPolicy {
  mode: 'any-extension' | 'exact'
  exactOrigins: ReadonlySet<string>
}

export function isChromeExtensionOrigin(origin: string): boolean {
  return CHROME_EXTENSION_ORIGIN_PATTERN.test(origin)
}

/** `envList` is `PR_PANEL_ALLOWED_EXTENSION_ORIGINS`: comma-separated exact Origins; empty = any extension. */
export function createExtensionOriginPolicy(envList?: string): ExtensionOriginPolicy {
  const origins = (envList ?? '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean)
  const invalid = origins.find((o) => !isChromeExtensionOrigin(o))
  if (invalid) throw new Error(`Invalid allowed extension Origin: ${invalid}`)
  const exactOrigins = new Set(origins)
  return { mode: exactOrigins.size ? 'exact' : 'any-extension', exactOrigins }
}

export function isAllowedExtensionOrigin(origin: string | undefined, policy: ExtensionOriginPolicy): boolean {
  if (!origin) return false
  const normalized = origin.toLowerCase()
  if (!isChromeExtensionOrigin(normalized)) return false
  return policy.mode === 'any-extension' || policy.exactOrigins.has(normalized)
}

/** Origin must pass the policy and the request target must be exactly `/` with no query. */
export function isAllowedWebSocketRequest(
  origin: string | undefined,
  url: string | undefined,
  policy: ExtensionOriginPolicy = createExtensionOriginPolicy(),
): boolean {
  if (!isAllowedExtensionOrigin(origin, policy)) return false
  if (!url) return false
  try {
    const base = 'ws://127.0.0.1'
    const parsed = new URL(url, base)
    return parsed.origin === base && parsed.pathname === '/' && parsed.search === '' && !url.includes('?')
  } catch {
    return false
  }
}
