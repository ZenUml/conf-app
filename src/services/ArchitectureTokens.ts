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

export async function getRelatedDiagrams(
  customContentId: string,
  timeoutMs = 8000,
): Promise<RelatedResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RelatedLookupError('timeout')), timeoutMs)
  })

  try {
    return await Promise.race([
      callRemote(
        `/api/architecture-tokens/related?customContentId=${encodeURIComponent(customContentId)}`,
        'GET',
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
