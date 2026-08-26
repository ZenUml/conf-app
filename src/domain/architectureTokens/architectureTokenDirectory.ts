/**
 * Browser-safe contract for a future local Architecture Token directory.
 *
 * The directory is deliberately separate from Mermaid evidence and the
 * Confluence binding envelope: it supplies an already-approved token reference
 * to a later explicit bind action, but does not create, persist, authorize, or
 * infer tokens. No default remote or global catalogue is implied.
 */
export type ArchitectureTokenDirectoryEntry = Readonly<{
  logicalTokenId: string;
  tokenId?: string;
  displayName: string;
}>;

export type ArchitectureTokenDirectoryResult =
  | Readonly<{
    kind: 'available';
    entries: readonly ArchitectureTokenDirectoryEntry[];
  }>
  | Readonly<{
    kind: 'unavailable';
    reason: 'not_configured' | 'invalid_directory';
  }>;

export interface ArchitectureTokenDirectory {
  list(): Promise<ArchitectureTokenDirectoryResult>;
}

/**
 * An explicitly supplied browser-memory snapshot for an Architecture Token
 * picker. It intentionally has no fetch, write, search, or token-creation
 * capability: host integration owns authorization and may pass only entries
 * that are already available to this browser session.
 */
export interface BrowserLocalArchitectureTokenDirectoryProvider {
  readonly locality: 'browser_local';
  snapshot(): ArchitectureTokenDirectoryResult;
}

/** Default until a product-owned local directory provider is supplied. */
export const noArchitectureTokenDirectory: ArchitectureTokenDirectory = {
  async list() {
    return { kind: 'unavailable', reason: 'not_configured' };
  },
};

/** Default when no product-owned browser-local directory is injected. */
export const noBrowserLocalArchitectureTokenDirectoryProvider: BrowserLocalArchitectureTokenDirectoryProvider = {
  locality: 'browser_local',
  snapshot() {
    return { kind: 'unavailable', reason: 'not_configured' };
  },
};

/**
 * Takes one strict local snapshot. The provider never retains the caller's
 * mutable input and has no I/O surface, so diagram code cannot discover or
 * manufacture enterprise tokens by itself.
 */
export function createBrowserLocalArchitectureTokenDirectoryProvider(
  input: unknown,
): BrowserLocalArchitectureTokenDirectoryProvider {
  const directory = immutableDirectorySnapshot(resolveArchitectureTokenDirectory(input));
  return {
    locality: 'browser_local',
    snapshot: () => directory,
  };
}

/**
 * Strictly validates an injected local directory. Entry display names remain
 * in the caller's local UI only; this module never merges them into a Diagram
 * or sends them to analytics.
 */
export function resolveArchitectureTokenDirectory(input: unknown): ArchitectureTokenDirectoryResult {
  if (!Array.isArray(input)) return { kind: 'unavailable', reason: 'invalid_directory' };

  const entries: ArchitectureTokenDirectoryEntry[] = [];
  const logicalTokenIds = new Set<string>();
  const tokenIds = new Set<string>();
  for (const candidate of input) {
    const entry = parseEntry(candidate);
    if (!entry) return { kind: 'unavailable', reason: 'invalid_directory' };
    if (logicalTokenIds.has(entry.logicalTokenId)) return { kind: 'unavailable', reason: 'invalid_directory' };
    if (entry.tokenId && tokenIds.has(entry.tokenId)) return { kind: 'unavailable', reason: 'invalid_directory' };
    logicalTokenIds.add(entry.logicalTokenId);
    if (entry.tokenId) tokenIds.add(entry.tokenId);
    entries.push(entry);
  }
  return { kind: 'available', entries };
}

export function findArchitectureTokenDirectoryEntry(
  directory: Extract<ArchitectureTokenDirectoryResult, { kind: 'available' }>,
  logicalTokenId: string,
): ArchitectureTokenDirectoryEntry | undefined {
  return directory.entries.find((entry) => entry.logicalTokenId === logicalTokenId);
}

function immutableDirectorySnapshot(
  directory: ArchitectureTokenDirectoryResult,
): ArchitectureTokenDirectoryResult {
  if (directory.kind === 'unavailable') return Object.freeze(directory);
  return Object.freeze({
    kind: 'available' as const,
    entries: Object.freeze(directory.entries.map((entry) => Object.freeze({ ...entry }))),
  });
}

function parseEntry(value: unknown): ArchitectureTokenDirectoryEntry | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (!keys.every((key) => key === 'logicalTokenId' || key === 'tokenId' || key === 'displayName')) return null;
  if (!Object.prototype.hasOwnProperty.call(value, 'logicalTokenId') || !Object.prototype.hasOwnProperty.call(value, 'displayName')) return null;
  const logicalTokenId = value.logicalTokenId;
  const tokenId = value.tokenId;
  const displayName = value.displayName;
  if (!isOpaqueIdentifier(logicalTokenId) || (tokenId !== undefined && !isOpaqueIdentifier(tokenId)) || typeof displayName !== 'string') return null;
  const normalizedDisplayName = displayName.trim();
  if (normalizedDisplayName.length === 0 || normalizedDisplayName.length > 512) return null;
  return tokenId === undefined
    ? { logicalTokenId, displayName: normalizedDisplayName }
    : { logicalTokenId, tokenId, displayName: normalizedDisplayName };
}

function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
