// Remembers which Confluence custom-content version this iframe loaded, so a
// feedback report can say which version of the diagram the reporter saw.
// Integer only: never the diagram body (Confluence is the system of record).
// Keyed by custom content id so a stale entry can never attach to another diagram.
const loadedVersions = new Map<string, number>()

export function rememberLoadedCustomContentVersion(
  customContentId: string | number | undefined | null,
  version: unknown,
): void {
  if (customContentId == null || customContentId === '') return
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return
  loadedVersions.set(String(customContentId), version)
}

export function loadedCustomContentVersion(customContentId: string | undefined): number | undefined {
  return customContentId ? loadedVersions.get(customContentId) : undefined
}

export function resetLoadedCustomContentVersions(): void {
  loadedVersions.clear()
}
