import type {
  ArchitectureTokenIndexSource,
  ArchitectureTokenStaleReason,
} from '@/utils/analytics/catalog'
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
  related: RelatedPage[]
  relatedTotal: number
}

export interface RelatedResponse {
  lookup_outcome?: 'indexed' | 'index_miss'
  indexedAt: string | null
  contentVersion: number | null
  participants: RelatedParticipant[]
  error_kind?: string
  stale_reason?: ArchitectureTokenStaleReason
  live_version?: number
  index_source?: ArchitectureTokenIndexSource
}

export class RelatedLookupError extends Error {
  constructor(public readonly kind: 'timeout' | 'network') {
    super(kind)
  }
}

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
          + (pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''),
        'GET',
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
