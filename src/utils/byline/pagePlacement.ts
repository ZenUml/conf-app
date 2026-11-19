/**
 * A spot on a page, chosen against one version of it and still meaningful
 * against the next.
 *
 * The picker draws the page and the write re-reads it, and somebody can publish
 * in between. A bare index would then put the diagram wherever that number now
 * lands, silently, on a customer's page. So a choice carries the two blocks it
 * sits between, and the write only goes ahead if it can still find them.
 *
 * Fingerprints rather than the nodes themselves because a choice travels through
 * `view.close(payload)`, and a neighbouring table can be arbitrarily large.
 */

export interface PagePlacement {
  /** Position in the document's top-level content, as of `version`. */
  index: number
  /** The page version this was chosen against. */
  version: number
  /** Fingerprint of the block before the gap; null at the start of the page. */
  after: string | null
  /** Fingerprint of the block after the gap; null at the end of the page. */
  before: string | null
}

/** A choice, plus what the surface that asked needs for its analytics. */
export interface PlacementChoice {
  placement: PagePlacement
  position: 'start' | 'middle' | 'end'
  blockCount: number
  defaultKept: boolean
}

/** cyrb53: small, fast, and collision-resistant enough for adjacent page blocks. */
export function fingerprintBlock(node: unknown): string {
  const text = JSON.stringify(node) ?? ''
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function placementAt(content: unknown[], index: number, version: number): PagePlacement {
  return {
    index,
    version,
    after: index > 0 ? fingerprintBlock(content[index - 1]) : null,
    before: index < content.length ? fingerprintBlock(content[index]) : null,
  }
}

/**
 * Where this choice lands in `content` now, or null when the spot is gone.
 *
 * The start and the end of a page survive any edit, so they always resolve. A
 * spot between two blocks has to find exactly that pair: no match means the
 * neighbours were edited, and more than one (repeated empty paragraphs, say)
 * means we would be guessing. Either way the user chooses again.
 */
export function resolveInsertIndex(
  content: unknown[],
  version: number,
  placement: PagePlacement,
): number | null {
  if (placement.before === null) return content.length
  if (placement.after === null) return 0
  if (version === placement.version) return placement.index
  const matches: number[] = []
  for (let i = 1; i < content.length; i++) {
    if (
      fingerprintBlock(content[i - 1]) === placement.after &&
      fingerprintBlock(content[i]) === placement.before
    ) {
      matches.push(i)
    }
  }
  return matches.length === 1 ? matches[0] : null
}
