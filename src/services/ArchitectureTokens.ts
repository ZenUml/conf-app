import { callRemote } from '@/utils/requestUtil'

export interface RelatedPage {
  contentId: string
  pageId: string
  pageTitle: string
  spaceKey: string
  rawLabelThere: string
}

export interface RelatedParticipant {
  actorId: string
  rawLabel: string
  /** The nearest few, already ordered and capped by the backend. */
  related: RelatedPage[]
  /** Every page the index holds for this name; `related` is a slice of it. */
  relatedTotal: number
}

export interface RelatedResponse {
  indexedAt: string | null
  contentVersion: number | null
  participants: RelatedParticipant[]
  error_kind?: string
}

export class RelatedLookupError extends Error {
  constructor(public readonly kind: 'timeout' | 'network') {
    super(kind)
  }
}

/**
 * `pageId` is the page the reader is on: the backend lists the nearest few positions, and
 * without it the reader's own page can fall outside that slice. Options rather than
 * positional arguments — inserting a parameter ahead of `timeoutMs` silently retargeted it.
 */
export async function getRelatedDiagrams(
  customContentId: string,
  { pageId, timeoutMs = 8000 }: { pageId?: string; timeoutMs?: number } = {},
): Promise<RelatedResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RelatedLookupError('timeout')), timeoutMs)
  })

  try {
    return await Promise.race([
      callRemote(
        `/api/architecture-tokens/related?customContentId=${encodeURIComponent(customContentId)}`
          // the reader's page, so the nearest position survives the backend's slice
          + (pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''),
        'GET',
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
