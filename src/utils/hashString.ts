// FNV-1a 32-bit hash, returned as hex. Deterministic and dependency-free —
// used as the dedup key for AI auto-title generation.
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}
