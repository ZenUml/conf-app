import { human } from '@/lib/format'
import type { Dataset, Grant, JsmTicket, OriginBucket } from './types'
import {
  EXTENSIONS_CONTRACT_VERSION,
  type ExtensionGrantRecord,
  type ExtensionOriginBucket,
  type ExtensionSourceName,
  type ExtensionSourceStatus,
  type ExtensionsResponse
} from './extensionsContract'

export interface ExtensionsLoadState {
  state: 'loading' | 'live' | 'partial' | 'error'
  generatedAt: string | null
  sources: Record<ExtensionSourceName, ExtensionSourceStatus> | null
  summary: ExtensionsResponse['summary'] | null
  incompleteGrantCount: number
  error: string | null
}

export const INITIAL_EXTENSIONS_LOAD: ExtensionsLoadState = {
  state: 'loading',
  generatedAt: null,
  sources: null,
  summary: null,
  incompleteGrantCount: 0,
  error: null
}

function displayDate(value: string): string {
  return human(value.slice(0, 10))
}

function durationLabel(createdAt: string, expiresAt: string): string | undefined {
  const days = Math.round(
    (Date.parse(expiresAt.slice(0, 10)) - Date.parse(createdAt.slice(0, 10))) / 86_400_000
  )
  return Number.isFinite(days) && days > 0 ? `${days}-day` : undefined
}

function grantKind(row: ExtensionGrantRecord): Grant['kind'] {
  if (row.ticketKey) return 'automatic'
  if (row.activatedBy?.startsWith('experiment:')) return 'off-convention'
  if (row.activatedBy?.startsWith('support:')) return 'no ticket'
  return row.activatedBy ? 'off-convention' : 'no ticket'
}

function toGrant(row: ExtensionGrantRecord): Grant {
  const marketplaceUnavailable = row.unknowns.includes('Marketplace site mapping is unavailable')
  return {
    id: row.id,
    created: row.createdAt ? displayDate(row.createdAt) : 'unknown',
    createdAt: row.createdAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    domain: row.domain ?? (
      marketplaceUnavailable
        ? `(site mapping unavailable · cloud ${row.cloudId.slice(0, 8)})`
        : `(not in Marketplace · cloud ${row.cloudId.slice(0, 8)})`
    ),
    siteMapping: row.domain
      ? 'matched'
      : marketplaceUnavailable
        ? 'unavailable'
        : 'unmatched',
    space: row.spaceKey,
    wide: row.scope === 'space',
    origin: row.activatedBy ?? '(not recorded)',
    activatedBy: row.activatedBy ?? undefined,
    ticketKey: row.ticketKey ?? undefined,
    requestTicket: row.request?.ticketKey,
    requestMatchedBy: row.request?.matchedBy,
    expires: row.expiresAt ? displayDate(row.expiresAt) : 'unknown',
    expiresAt: row.expiresAt ?? undefined,
    active: row.status === 'active',
    status: row.status,
    kind: grantKind(row),
    days: row.createdAt && row.expiresAt ? durationLabel(row.createdAt, row.expiresAt) : undefined,
    cloudId: row.cloudId,
    userAccountId: row.userAccountId ?? undefined,
    storedStatus: row.storedStatus,
    sourceObservedAt: row.statusDerivedAt,
    actionAudit: row.actionAudit,
    history: row.history,
    unknowns: row.unknowns,
    marketplace: row.marketplace
  }
}

function jsmNote(row: ExtensionGrantRecord): string {
  const request = row.request
  if (!request) return ''
  const notes: string[] = []
  if (request.matchedBy === 'domain_space') notes.push('matched by domain + space, not activatedBy ticket')
  if (request.typedDomain && request.typedDomain !== '(unknown)' && row.domain && request.typedDomain !== row.domain) {
    notes.push('typed domain differs from Marketplace site')
  }
  if (request.typedSpace && request.typedSpace !== '(unknown)' && request.typedSpace !== row.spaceKey) {
    notes.push('typed space differs from KV grant')
  }
  if (request.comments.state === 'unknown') notes.push(request.comments.reason ?? 'comments unavailable')
  return notes.join(' · ')
}

function toJsm(grants: ExtensionGrantRecord[]): Record<string, JsmTicket> {
  const entries = grants.flatMap(row => {
    const request = row.request
    if (!request) return []
    const accountId = request.targetUserAccountId ?? row.userAccountId ?? 'unknown'
    const reporterAccountId = request.requesterAccountId ?? undefined
    const lastCommentDate = request.comments.lastCommentAt
      ? displayDate(request.comments.lastCommentAt)
      : request.updatedAt
        ? displayDate(request.updatedAt)
        : 'unknown'
    return [[request.ticketKey, {
      requester: request.requester ?? 'unknown requester',
      accountId,
      reporterAccountId,
      status: request.status ?? 'unknown',
      lastReply: lastCommentDate,
      replies: request.comments.publicCommentCount ?? 0,
      typedDomain: request.typedDomain ?? '(unknown)',
      typedSpace: request.typedSpace ?? '(unknown)',
      // The JSM payload used here carries a reporter account id, not an
      // authenticated-vs-portal fact. Account-id shape is not proof.
      portalUnsigned: null,
      note: jsmNote(row),
      commentsKnown: request.comments.state === 'known',
      publicComments: request.comments.publicCommentCount,
      requesterComments: request.comments.requesterCommentCount,
      lastCommentAuthor: request.comments.lastCommentAuthor,
      matchedBy: request.matchedBy,
      macroCount: request.macroCount,
      macrosLimit: request.macrosLimit
    } satisfies JsmTicket] as const]
  })
  return Object.fromEntries(entries)
}

const ORIGIN_COPY: Record<ExtensionOriginBucket['key'], Omit<OriginBucket, 'n'>> = {
  jsm_ticketed: {
    label: 'JSM ticket recorded',
    accent: 'brand',
    note: 'activatedBy contains a recoverable ZEN ticket.',
    pattern: '…ZEN-####'
  },
  support_unticketed: {
    label: 'Support, no ticket key',
    accent: 'cerulean',
    note: 'activatedBy uses the support prefix but carries no recoverable ZEN ticket.',
    pattern: 'support:*'
  },
  experiment: {
    label: 'Experiment',
    accent: 'radical',
    note: 'activatedBy identifies an experiment rather than a support request.',
    pattern: 'experiment:*'
  },
  other: {
    label: 'Other recorded origin',
    accent: 'rust',
    note: 'activatedBy is present but does not follow the support or experiment conventions.',
    pattern: 'non-standard value'
  },
  unknown: {
    label: 'Origin unknown',
    accent: 'rust',
    note: 'activatedBy is absent, so no origin can be claimed.',
    pattern: '(missing)'
  }
}

function toOrigins(rows: ExtensionOriginBucket[]): OriginBucket[] {
  return rows.map(row => ({ n: row.count, ...ORIGIN_COPY[row.key] }))
}

export async function loadExtensionsDataset(base: Dataset): Promise<{
  data: Dataset
  load: ExtensionsLoadState
}> {
  const response = await fetch('/api/local-crm/extensions', {
    headers: { accept: 'application/json' },
    cache: 'no-store'
  })
  const body = await response.json() as ExtensionsResponse | { detail?: string }
  if (!response.ok) {
    throw new Error('detail' in body && body.detail ? body.detail : `Extensions API returned ${response.status}`)
  }
  if (!('contractVersion' in body) || body.contractVersion !== EXTENSIONS_CONTRACT_VERSION) {
    throw new Error('Extensions API contract version is unsupported')
  }
  const grants = body.grants.map(toGrant)
  const incompleteGrantCount = body.grants.filter(row => !row.createdAt || !row.expiresAt).length
  const sourceUnavailable = Object.values(body.sources).some(source => source.state === 'error')
  return {
    data: {
      ...base,
      today: body.asOf,
      grants,
      jsm: toJsm(body.grants),
      jsmUnconfirmedAuthor: [],
      origins: toOrigins(body.summary.originBuckets)
    },
    load: {
      state: sourceUnavailable || incompleteGrantCount > 0 ? 'partial' : 'live',
      generatedAt: body.generatedAt,
      sources: body.sources,
      summary: body.summary,
      incompleteGrantCount,
      error: null
    }
  }
}
