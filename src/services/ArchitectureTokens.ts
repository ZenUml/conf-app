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
  /** Optional only for compatibility with a backend deployed before outcome telemetry. */
  lookup_outcome?: 'indexed' | 'index_miss'
  indexedAt: string | null
  contentVersion: number | null
  participants: RelatedParticipant[]
  error_kind?: string
}

/**
 * `network` means no HTTP answer at all. An answer with a status is `no_user_credential`
 * (403 and a body that says so: Forge sent no user token) or `http_error` with its status.
 */
export type RelatedLookupErrorKind = 'timeout' | 'network' | 'no_user_credential' | 'http_error'

export class RelatedLookupError extends Error {
  constructor(
    public readonly kind: RelatedLookupErrorKind,
    public readonly httpStatus?: number,
  ) {
    super(kind)
  }
}

/** The backend's guest/anonymous answer; see `requireForgeUserToken`. */
const NO_USER_CREDENTIAL = 'no_user_credential'

/**
 * `callRemote` throws Error('HTTP <status>: <body>') with `.status` for any non-2xx answer, so
 * the body is only in the message. The message format is pinned by requestUtil.spec.
 */
function classifyLookupError(error: unknown): unknown {
  if (error instanceof RelatedLookupError) return error
  const { status, message } = (error ?? {}) as { status?: unknown; message?: unknown }
  if (typeof status !== 'number') return new RelatedLookupError('network')
  return status === 403 && typeof message === 'string' && message.includes(NO_USER_CREDENTIAL)
    ? new RelatedLookupError('no_user_credential', status)
    : new RelatedLookupError('http_error', status)
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
      ).catch((error) => {
        throw classifyLookupError(error)
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
