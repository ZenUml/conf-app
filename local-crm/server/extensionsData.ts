import { createHash } from 'node:crypto'
import {
  EXTENSIONS_CONTRACT_VERSION,
  type PriorGrantSummary,
  type ExtensionActionAudit,
  type ExtensionGrantRecord,
  type ExtensionHistoryEntry,
  type ExtensionOriginBucket,
  type OpenExtensionRequestStream,
  type ExtensionRequestContext,
  type ExtensionSourceName,
  type ExtensionSourceStatus,
  type ExtensionsResponse,
  type MarketplaceLicenseContext
} from '../src/data/extensionsContract'

type JsonRecord = Record<string, unknown>

export interface RawGrantValue {
  key: string
  value: unknown
}

export interface ExtensionsDataInput {
  generatedAt: string
  marketplaceRows: unknown[]
  jsmIssues: unknown[]
  jsmCommentsByTicket: Map<string, unknown[] | null>
  grantValues: RawGrantValue[]
  actionRows: unknown[]
  /** Keys returned by JSM's open-request query, separate from historic joins. */
  openJsmTicketKeys?: string[]
  /** The bounded JSM search may stop before the complete open-request set. */
  openJsmSearchTruncated?: boolean
  sourceErrors?: Partial<Record<ExtensionSourceName, string>>
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function isoOrNull(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null
  return new Date(candidate).toISOString()
}

function normalizeDomain(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const withoutProtocol = raw.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  return withoutProtocol.endsWith('.atlassian.net')
    ? withoutProtocol.slice(0, -'.atlassian.net'.length)
    : withoutProtocol
}

function stableId(key: string): string {
  return `grant_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

const APP_BY_ADDON: Record<string, MarketplaceLicenseContext['app']> = {
  'com.zenuml.confluence-addon-lite': 'lite',
  'com.zenuml.confluence-addon': 'full',
  'gptdock-confluence': 'diagramly',
  // Historical exports used this key. Keeping it here costs nothing and
  // prevents an older local snapshot from silently losing its app label.
  'com.pnd.jira.plugins.diagramly': 'diagramly',
  'my-api': 'asyncapi'
}

interface MarketplaceSite {
  domain: string | null
  licenses: MarketplaceLicenseContext[]
}

function marketplaceByCloudId(rows: unknown[]): Map<string, MarketplaceSite> {
  const sites = new Map<string, MarketplaceSite>()
  rows.forEach(value => {
    const row = record(value)
    const cloudId = text(row?.cloudId)
    if (!row || !cloudId) return
    const addonKey = text(row.addonKey)
    const context: MarketplaceLicenseContext = {
      app: addonKey ? (APP_BY_ADDON[addonKey] ?? 'unknown') : 'unknown',
      licenseType: text(row.licenseType),
      status: text(row.status),
      tier: text(row.tier),
      evaluationStartedAt: isoOrNull(row.latestEvaluationStartDate),
      evaluationEndsAt: text(row.licenseType) === 'EVALUATION'
        ? isoOrNull(row.maintenanceEndDate)
        : null
    }
    const existing = sites.get(cloudId)
    if (existing) {
      existing.domain ??= normalizeDomain(row.cloudSiteHostname)
      existing.licenses.push(context)
    } else {
      sites.set(cloudId, {
        domain: normalizeDomain(row.cloudSiteHostname),
        licenses: [context]
      })
    }
  })
  return sites
}

function flattenAdf(value: unknown): string {
  const node = record(value)
  if (!node) return ''
  if (node.type === 'hardBreak') return '\n'
  const ownText = text(node.text) ?? ''
  const content = Array.isArray(node.content) ? node.content : []
  const rendered = ownText + content.map(flattenAdf).join('')
  return node.type === 'paragraph' ? `${rendered}\n` : rendered
}

function fieldFromDescription(description: string, label: string): string | null {
  const match = description.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'))
  return match?.[1]?.trim() || null
}

interface ParsedJsmIssue {
  ticketKey: string
  status: string | null
  requester: string | null
  requesterAccountId: string | null
  targetUserAccountId: string | null
  typedDomain: string | null
  typedSpace: string | null
  macroCount: number | null
  macrosLimit: number | null
  createdAt: string | null
  updatedAt: string | null
}

function parseJsmIssue(value: unknown): ParsedJsmIssue | null {
  const issue = record(value)
  const ticketKey = text(issue?.key)
  const fields = record(issue?.fields)
  if (!issue || !ticketKey || !fields) return null
  const status = record(fields.status)
  const reporter = record(fields.reporter)
  const description = flattenAdf(fields.description)
  return {
    ticketKey,
    status: text(status?.name),
    requester: text(reporter?.displayName) ?? text(reporter?.emailAddress),
    requesterAccountId: text(reporter?.accountId),
    targetUserAccountId: fieldFromDescription(description, 'User account ID'),
    typedDomain: normalizeDomain(fieldFromDescription(description, 'Client domain')),
    typedSpace: fieldFromDescription(description, 'Space key'),
    macroCount: numberValue(fieldFromDescription(description, 'Macro count')),
    macrosLimit: numberValue(fieldFromDescription(description, 'Limit')),
    createdAt: isoOrNull(fields.created),
    updatedAt: isoOrNull(fields.updated)
  }
}

function commentEvidence(
  comments: unknown[] | null | undefined,
  requesterAccountId: string | null
): ExtensionRequestContext['comments'] {
  if (comments === null || comments === undefined) {
    return {
      state: 'unknown',
      publicCommentCount: null,
      requesterCommentCount: null,
      lastCommentAt: null,
      lastCommentAuthor: null,
      lastCommentAuthorship: 'unknown',
      reason: 'JSM comments were unavailable'
    }
  }
  const parsed = comments
    .map(value => {
      const row = record(value)
      const author = record(row?.author)
      if (!row) return null
      return {
        author: text(author?.displayName),
        authorAccountId: text(author?.accountId),
        at: isoOrNull(row.created),
        public: row.jsdPublic === true
      }
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
  const publicComments = parsed.filter(item => item.public)
  const requesterComments = requesterAccountId
    ? publicComments.filter(item => item.authorAccountId === requesterAccountId)
    : []
  const last = parsed.at(-1) ?? null
  const lastAuthorship = !last || !requesterAccountId || !last.authorAccountId
    ? 'unknown'
    : last.authorAccountId === requesterAccountId
      ? 'requester'
      : 'non_requester'
  return {
    state: 'known',
    publicCommentCount: publicComments.length,
    requesterCommentCount: requesterAccountId ? requesterComments.length : null,
    lastCommentAt: last?.at ?? null,
    lastCommentAuthor: last?.author ?? null,
    lastCommentAuthorship: lastAuthorship,
    reason: requesterAccountId ? null : 'Requester account id was unavailable for authorship matching'
  }
}

function ticketFromActivatedBy(value: string | null): string | null {
  return value?.match(/\bZEN-[1-9][0-9]*\b/i)?.[0]?.toUpperCase() ?? null
}

function scopeFromKey(key: string): 'user' | 'space' {
  const parts = key.split(':')
  return parts.length > 3 ? 'user' : 'space'
}

function accountFromKey(key: string): string | null {
  const parts = key.split(':')
  return parts.length > 3 ? text(parts.slice(3).join(':')) : null
}

function deriveStatus(
  storedStatus: ExtensionGrantRecord['storedStatus'],
  expiresAt: string | null,
  generatedAt: string
): ExtensionGrantRecord['status'] {
  if (storedStatus === 'inactive') return 'inactive'
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return 'unknown'
  if (Date.parse(expiresAt) < Date.parse(generatedAt)) return 'expired'
  return storedStatus === 'active' ? 'active' : 'unknown'
}

function actionAuditForGrant(rows: unknown[], grant: {
  ticketKey: string | null
  cloudId: string
  spaceKey: string
  scope: 'user' | 'space'
  userAccountId: string | null
  expiresAt: string | null
}): ExtensionActionAudit[] {
  return rows.flatMap(value => {
    const row = record(value)
    if (!row) return []
    const rowTicket = text(row.ticketKey)
    const rowCloud = text(row.cloudId)
    const rowSpace = text(row.spaceKey)
    const rowAccount = text(row.userAccountId)
    const rowExpiresAt = isoOrNull(row.expiresAt)
    const scopeMatch = grant.scope === 'space'
      ? rowAccount === null
      : Boolean(grant.userAccountId && rowAccount === grant.userAccountId)
    const targetMatch = rowCloud === grant.cloudId
      && rowSpace === grant.spaceKey
      && scopeMatch
    // A ticket alone is not a grant target: one ticket/domain/space can carry
    // both a user-scoped and a space-scoped record. Require the exact KV
    // target, exact current expiry, and the ticket explicitly recorded in
    // activatedBy. Ticketless/manual grants cannot absorb a ticketed action.
    if (!targetMatch) return []
    if (!grant.ticketKey || rowTicket !== grant.ticketKey) return []
    if (!grant.expiresAt || rowExpiresAt !== grant.expiresAt) return []
    const action = text(row.action)
    const status = text(row.status)
    return [{
      action: action === 'initial' || action === 'feedback' ? action : 'unknown',
      status: status === 'pending' || status === 'applied' ? status : 'unknown',
      macroCount: numberValue(row.macroCount),
      expiresAt: rowExpiresAt,
      createdAt: isoOrNull(row.createdAt),
      updatedAt: isoOrNull(row.updatedAt)
    }]
  })
}

function historyForGrant(
  createdAt: string | null,
  updatedAt: string | null,
  audit: ExtensionActionAudit[]
): ExtensionHistoryEntry[] {
  const history: ExtensionHistoryEntry[] = []
  if (createdAt) {
    history.push({
      kind: 'kv_record_created',
      at: createdAt,
      label: 'Current KV record was created',
      evidence: 'space_license_kv'
    })
  }
  if (updatedAt && updatedAt !== createdAt) {
    history.push({
      kind: 'kv_record_updated',
      at: updatedAt,
      label: 'Current KV record was updated',
      evidence: 'space_license_kv'
    })
  }
  audit.forEach(row => {
    history.push({
      kind: 'extension_action',
      at: row.updatedAt ?? row.createdAt,
      label: `${row.action} action · ${row.status}`,
      evidence: 'extension_action_d1'
    })
  })
  return history.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
}

function sourceStatus(
  state: 'ok' | 'error',
  records: number,
  okDetail: string,
  error?: string
): ExtensionSourceStatus {
  return {
    state,
    records,
    detail: state === 'ok' ? okDetail : (error ?? 'source unavailable')
  }
}

function originBucket(activatedBy: string | null, ticketKey: string | null): ExtensionOriginBucket['key'] {
  if (!activatedBy) return 'unknown'
  if (ticketKey) return 'jsm_ticketed'
  if (activatedBy.startsWith('experiment:')) return 'experiment'
  if (activatedBy.startsWith('support:')) return 'support_unticketed'
  return 'other'
}

/**
 * Current KV grants for one cloud ID and space. A request for a space that already
 * holds an active grant is a different decision from a first ask, and nothing in KV
 * records that a grant was a repeat.
 */
function priorGrantsFor(
  grants: ExtensionGrantRecord[],
  cloudId: string | null,
  spaceKey: string | null
): PriorGrantSummary {
  if (!cloudId || !spaceKey) return { count: 0, activeCount: 0, latestExpiresAt: null }
  const matching = grants.filter(grant => grant.cloudId === cloudId && grant.spaceKey === spaceKey)
  return {
    count: matching.length,
    activeCount: matching.filter(grant => grant.status === 'active').length,
    latestExpiresAt: matching
      .map(grant => grant.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  }
}

export function buildExtensionsResponse(input: ExtensionsDataInput): ExtensionsResponse {
  const sourceErrors = input.sourceErrors ?? {}
  const marketplace = marketplaceByCloudId(input.marketplaceRows)
  // The JSM form records a domain, KV records a cloud ID. The Marketplace rows are
  // the only join between them, and a request whose domain matches no site keeps a
  // null cloud ID rather than a guess.
  const cloudIdByDomain = new Map<string, string>()
  marketplace.forEach((site, cloudId) => {
    if (site.domain && !cloudIdByDomain.has(site.domain)) cloudIdByDomain.set(site.domain, cloudId)
  })
  const issues = input.jsmIssues
    .map(parseJsmIssue)
    .filter((value): value is ParsedJsmIssue => value !== null)
  const issuesByTicket = new Map(issues.map(issue => [issue.ticketKey, issue]))
  const issuesByDomainSpace = new Map<string, ParsedJsmIssue[]>()
  issues.forEach(issue => {
    if (!issue.typedDomain || !issue.typedSpace) return
    const key = `${issue.typedDomain}\u0000${issue.typedSpace}`
    const existing = issuesByDomainSpace.get(key) ?? []
    existing.push(issue)
    existing.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    issuesByDomainSpace.set(key, existing)
  })

  const grants = input.grantValues.flatMap(({ key, value }) => {
    const row = record(value)
    if (!row) return []
    const parts = key.split(':')
    if (parts[0] !== 'license') return []
    const cloudId = text(parts[1])
    const spaceKey = text(parts[2])
    if (!cloudId || !spaceKey) return []
    const scope = scopeFromKey(key)
    const userAccountId = scope === 'user'
      ? accountFromKey(key)
      : null
    const rawStoredStatus = text(row.status)
    const storedStatus: ExtensionGrantRecord['storedStatus'] = rawStoredStatus === 'active'
      ? 'active'
      : rawStoredStatus === 'inactive'
        ? 'inactive'
        : 'unknown'
    const activatedBy = text(row.activatedBy)
    const ticketKey = ticketFromActivatedBy(activatedBy)
    const site = marketplace.get(cloudId)
    const createdAt = isoOrNull(row.createdAt)
    const updatedAt = isoOrNull(row.updatedAt)
    const expiresAt = isoOrNull(row.expiresAt)
    const grantObservedAt = updatedAt ?? createdAt
    const ticketIssue = ticketKey ? issuesByTicket.get(ticketKey) : undefined
    const fallbackIssue = site?.domain && grantObservedAt
      ? issuesByDomainSpace
          .get(`${site.domain}\u0000${spaceKey}`)
          ?.find(issue => Boolean(
            issue.createdAt
              && issue.createdAt <= grantObservedAt
              && (scope === 'user'
                ? Boolean(userAccountId && issue.targetUserAccountId === userAccountId)
                : issue.targetUserAccountId === null)
          ))
      : undefined
    const matchedIssue = ticketIssue ?? fallbackIssue
    const matchedBy: ExtensionRequestContext['matchedBy'] | null = ticketIssue
      ? 'ticket_key'
      : fallbackIssue
        ? 'domain_space'
        : null
    const request = matchedIssue && matchedBy
      ? {
          ticketKey: matchedIssue.ticketKey,
          status: matchedIssue.status,
          requester: matchedIssue.requester,
          requesterAccountId: matchedIssue.requesterAccountId,
          targetUserAccountId: matchedIssue.targetUserAccountId,
          typedDomain: matchedIssue.typedDomain,
          typedSpace: matchedIssue.typedSpace,
          macroCount: matchedIssue.macroCount,
          macrosLimit: matchedIssue.macrosLimit,
          createdAt: matchedIssue.createdAt,
          updatedAt: matchedIssue.updatedAt,
          matchedBy,
          comments: commentEvidence(
            input.jsmCommentsByTicket.get(matchedIssue.ticketKey),
            matchedIssue.requesterAccountId
          )
        } satisfies ExtensionRequestContext
      : null
    const status = deriveStatus(storedStatus, expiresAt, input.generatedAt)
    const actionAudit = actionAuditForGrant(input.actionRows, {
      ticketKey,
      cloudId,
      spaceKey,
      scope,
      userAccountId,
      expiresAt
    })
    const unknowns: string[] = []
    const valueCloudId = text(row.cloudId)
    const valueSpaceKey = text(row.spaceKey)
    const valueUserAccountId = text(row.userAccountId)
    if (scope === 'user' && !userAccountId) {
      unknowns.push('user-scoped KV key has no usable account id')
    }
    if (valueCloudId && valueCloudId !== cloudId) {
      unknowns.push('KV value cloudId differs from the authoritative key')
    }
    if (valueSpaceKey && valueSpaceKey !== spaceKey) {
      unknowns.push('KV value spaceKey differs from the authoritative key')
    }
    if ((scope === 'user' && valueUserAccountId && valueUserAccountId !== userAccountId)
      || (scope === 'space' && valueUserAccountId)) {
      unknowns.push('KV value user scope differs from the authoritative key')
    }
    if (!site?.domain) {
      unknowns.push(sourceErrors.marketplace
        ? 'Marketplace site mapping is unavailable'
        : 'site domain is not available')
    }
    if (!expiresAt) unknowns.push('grant expiry is missing or invalid')
    if (!activatedBy) unknowns.push('grant origin is not recorded')
    if (request?.matchedBy === 'ticket_key') {
      const requestScopeMismatch = scope === 'user'
        ? Boolean(request.targetUserAccountId && request.targetUserAccountId !== userAccountId)
        : Boolean(request.targetUserAccountId)
      if (requestScopeMismatch) {
        unknowns.push('recorded JSM request target differs from the authoritative KV key')
      }
    }
    if (!request) {
      unknowns.push(sourceErrors.jsm
        ? 'JSM request matching is unavailable'
        : 'no JSM request candidate matched in the fetched search window')
    }
    if (!actionAudit.length) {
      unknowns.push(sourceErrors.extension_action_d1
        ? 'ExtensionAction audit source is unavailable'
        : 'no ExtensionAction audit row exists')
    }
    if (request?.comments.state === 'unknown') unknowns.push('JSM comment evidence is unavailable')

    return [{
      id: stableId(key),
      cloudId,
      // `domain` is a Marketplace-resolved site identity. The requester-typed
      // JSM value remains in `request.typedDomain` and is never promoted here.
      domain: site?.domain ?? null,
      spaceKey,
      scope,
      userAccountId,
      storedStatus,
      status,
      statusDerivedAt: input.generatedAt,
      activatedBy,
      ticketKey,
      createdAt,
      updatedAt,
      expiresAt,
      marketplace: site?.licenses ?? [],
      request,
      actionAudit,
      history: historyForGrant(createdAt, updatedAt, actionAudit),
      unknowns
    } satisfies ExtensionGrantRecord]
  }).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  const originCounts = new Map<ExtensionOriginBucket['key'], number>()
  grants.forEach(grant => {
    const key = originBucket(grant.activatedBy, ticketFromActivatedBy(grant.activatedBy))
    originCounts.set(key, (originCounts.get(key) ?? 0) + 1)
  })
  const originBuckets = [...originCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  const openRequestTicketKeys = [...new Set(input.openJsmTicketKeys ?? [])]
  const recordedGrantTickets = new Set(
    grants.flatMap(grant => grant.ticketKey ? [grant.ticketKey] : [])
  )
  const openRequests: OpenExtensionRequestStream = sourceErrors.jsm || sourceErrors.space_license_kv
    ? {
        state: 'unavailable',
        detail: sourceErrors.jsm
          ? 'Open JSM request comparison is unavailable because JSM could not be read.'
          : 'Open JSM request comparison is unavailable because the current grant KV could not be read.',
        rows: [],
        summary: { currentGrantObserved: 0, noCurrentGrantObserved: 0, insufficientEvidence: 0 }
      }
    : {
        state: input.openJsmSearchTruncated ? 'truncated' : 'complete',
        detail: input.openJsmSearchTruncated
          ? 'Open JSM requests exceeded the fetched 1,000-result search window; displayed rows are only that fetched subset.'
          : 'Open JSM requests are compared to current KV grants by exact ticket key only.',
        rows: openRequestTicketKeys
          .map(ticketKey => {
            const issue = issuesByTicket.get(ticketKey)
            // The queue decides grant-or-refuse from the row itself, so the row
            // carries what that decision needs: where the site is, who asked, how
            // far past the limit they are, and whether this space was granted
            // before. Every field here is already parsed above.
            const cloudId = issue?.typedDomain ? (cloudIdByDomain.get(issue.typedDomain) ?? null) : null
            return {
              ticketKey,
              status: issue?.status ?? null,
              createdAt: issue?.createdAt ?? null,
              updatedAt: issue?.updatedAt ?? null,
              typedDomain: issue?.typedDomain ?? null,
              typedSpace: issue?.typedSpace ?? null,
              currentGrant: (issue
                ? (recordedGrantTickets.has(ticketKey) ? 'observed' : 'not_observed')
                : 'insufficient') as 'observed' | 'not_observed' | 'insufficient',
              cloudId,
              requester: issue?.requester ?? null,
              macroCount: issue?.macroCount ?? null,
              macrosLimit: issue?.macrosLimit ?? null,
              priorGrants: priorGrantsFor(grants, cloudId, issue?.typedSpace ?? null),
              comments: commentEvidence(
                input.jsmCommentsByTicket.get(ticketKey),
                issue?.requesterAccountId ?? null
              )
            }
          })
          .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.ticketKey.localeCompare(b.ticketKey)),
        summary: { currentGrantObserved: 0, noCurrentGrantObserved: 0, insufficientEvidence: 0 }
      }
  openRequests.rows.forEach(row => {
    if (row.currentGrant === 'observed') openRequests.summary.currentGrantObserved += 1
    else if (row.currentGrant === 'not_observed') openRequests.summary.noCurrentGrantObserved += 1
    else openRequests.summary.insufficientEvidence += 1
  })

  return {
    contractVersion: EXTENSIONS_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    asOf: input.generatedAt.slice(0, 10),
    sources: {
      marketplace: sourceStatus(
        sourceErrors.marketplace ? 'error' : 'ok',
        input.marketplaceRows.length,
        'Marketplace reporting export',
        sourceErrors.marketplace
      ),
      jsm: sourceStatus(
        sourceErrors.jsm ? 'error' : 'ok',
        issues.length,
        'ZEN JSM issues and comments',
        sourceErrors.jsm
      ),
      space_license_kv: sourceStatus(
        sourceErrors.space_license_kv ? 'error' : 'ok',
        input.grantValues.length,
        'SPACE_LICENSE_KV license:* values',
        sourceErrors.space_license_kv
      ),
      extension_action_d1: sourceStatus(
        sourceErrors.extension_action_d1 ? 'error' : 'ok',
        input.actionRows.length,
        'D1 ExtensionAction rows',
        sourceErrors.extension_action_d1
      )
    },
    summary: {
      grantCount: grants.length,
      activeCount: grants.filter(grant => grant.status === 'active').length,
      expiredCount: grants.filter(grant => grant.status === 'expired').length,
      inactiveCount: grants.filter(grant => grant.status === 'inactive').length,
      unknownStatusCount: grants.filter(grant => grant.status === 'unknown').length,
      tenantCount: new Set(grants.map(grant => grant.cloudId)).size,
      auditedGrantCount: grants.filter(grant => grant.actionAudit.length > 0).length,
      matchedRequestCount: grants.filter(grant => grant.request !== null).length,
      originBuckets
    },
    grants,
    openRequests
  }
}
