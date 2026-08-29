import { jsmOf, recordedTicketOf, ticketOf, grantStatusOf } from '@/lib/lifecycle'
import type { ExtensionsLoadState } from './extensionsApi'
import type { Dataset, Grant } from './types'

export type PendingGrantMode = 'loading' | 'live' | 'partial' | 'unavailable'
export type PendingMappingKind = 'no_marketplace_row' | 'hostname_missing'
export type PendingReviewBand = 'active' | 'status unknown' | 'expired' | 'inactive'

export interface PendingAssignmentRow {
  id: string
  grantId: string
  eventId: string
  cloudPrefix: string
  space: string
  scope: 'whole space' | 'one requester'
  status: NonNullable<Grant['status']>
  reviewBand: PendingReviewBand
  mappingKind: PendingMappingKind
  mappingEvidence: string
  createdAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  observedAt: string | null
  origin: string
  requestEvidence: string
  requestEvidenceState: 'known' | 'unknown' | 'unavailable'
  actionEvidence: string
  actionEvidenceState: 'known' | 'unknown' | 'unavailable'
  unknowns: string[]
}

export interface PendingSummary {
  total: number
  active: number
  unknown: number
  expired: number
  inactive: number
  withRequestEvidence: number
}

/**
 * Queue membership requires both the current grant truth and a successful
 * Marketplace join. JSM and D1 enrich review evidence but do not define it.
 */
export function pendingGrantMode(load: ExtensionsLoadState): PendingGrantMode {
  if (load.state === 'loading') return 'loading'
  if (
    load.state === 'error'
    || load.sources?.space_license_kv.state !== 'ok'
    || load.sources?.marketplace.state !== 'ok'
  ) return 'unavailable'
  return load.state
}

/** Explain every condition that can make an otherwise usable snapshot partial. */
export function pendingPartialDetail(load: ExtensionsLoadState): string {
  const reasons: string[] = []
  if (load.sources?.jsm.state === 'error') {
    reasons.push('JSM request evidence is unavailable.')
  }
  if (load.sources?.extension_action_d1.state === 'error') {
    reasons.push('ExtensionAction audit evidence is unavailable.')
  }
  if (load.incompleteGrantCount > 0) {
    reasons.push(
      `${load.incompleteGrantCount} current grant ${load.incompleteGrantCount === 1 ? 'record has' : 'records have'} incomplete timestamp evidence.`
    )
  }
  return reasons.join(' ') || 'Some source evidence remains incomplete.'
}

/**
 * Pending shares the Extensions snapshot but never falls back to fixture
 * grants. The sanitized baseline remains only for unrelated screen fields.
 */
export function buildPendingDataset(
  base: Dataset,
  extensions: Dataset,
  load: ExtensionsLoadState
): Dataset {
  const mode = pendingGrantMode(load)
  if (mode === 'live' || mode === 'partial') {
    return {
      ...base,
      today: extensions.today,
      grants: extensions.grants,
      jsm: extensions.jsm,
      jsmUnconfirmedAuthor: extensions.jsmUnconfirmedAuthor,
      origins: extensions.origins
    }
  }
  return {
    ...base,
    grants: [],
    jsm: {},
    jsmUnconfirmedAuthor: [],
    origins: []
  }
}

function reviewBand(grant: Grant): PendingReviewBand {
  const status = grantStatusOf(grant)
  return status === 'unknown' ? 'status unknown' : status
}

function evidenceRank(grant: Grant): number {
  if (grant.marketplace?.length) return 0
  if (recordedTicketOf(grant)) return 1
  if (ticketOf(grant)) return 2
  return 3
}

const STATUS_RANK: Record<NonNullable<Grant['status']>, number> = {
  active: 0,
  unknown: 1,
  expired: 2,
  inactive: 3
}

function dateRank(grant: Grant): string {
  const status = grantStatusOf(grant)
  if (status === 'active') return grant.expiresAt ?? '9999-12-31T23:59:59.999Z'
  return grant.expiresAt ?? grant.updatedAt ?? grant.sourceObservedAt ?? ''
}

function compareRows(a: { grant: Grant; row: PendingAssignmentRow }, b: { grant: Grant; row: PendingAssignmentRow }): number {
  const aStatus = grantStatusOf(a.grant)
  const bStatus = grantStatusOf(b.grant)
  const status = STATUS_RANK[aStatus] - STATUS_RANK[bStatus]
  if (status) return status
  const evidence = evidenceRank(a.grant) - evidenceRank(b.grant)
  if (evidence) return evidence
  const aDate = dateRank(a.grant)
  const bDate = dateRank(b.grant)
  const date = aStatus === 'active'
    ? aDate.localeCompare(bDate)
    : bDate.localeCompare(aDate)
  return date || a.row.id.localeCompare(b.row.id)
}

function requestEvidence(data: Dataset, grant: Grant): Pick<
  PendingAssignmentRow,
  'requestEvidence' | 'requestEvidenceState'
> {
  if (grant.unknowns?.includes('JSM request matching is unavailable')) {
    return {
      requestEvidence: 'JSM request evidence is unavailable; absence cannot be established.',
      requestEvidenceState: 'unavailable'
    }
  }
  const recorded = recordedTicketOf(grant)
  const requestTicket = ticketOf(grant)
  const request = jsmOf(data, grant)
  if (recorded && request) {
    return {
      requestEvidence: `${recorded} · ${request.status} · explicit ticket recorded in activatedBy`,
      requestEvidenceState: 'known'
    }
  }
  if (recorded) {
    return {
      requestEvidence: `${recorded} is recorded in activatedBy; JSM did not return matching request evidence.`,
      requestEvidenceState: 'unknown'
    }
  }
  if (requestTicket && request) {
    return {
      requestEvidence: `${requestTicket} · ${request.status} · correlated context, not recorded grant origin`,
      requestEvidenceState: 'known'
    }
  }
  return {
    requestEvidence: 'No explicit ticket is recorded; domain correlation cannot run without a verified Marketplace site.',
    requestEvidenceState: 'unknown'
  }
}

function actionEvidence(grant: Grant): Pick<
  PendingAssignmentRow,
  'actionEvidence' | 'actionEvidenceState'
> {
  if (grant.unknowns?.includes('ExtensionAction audit source is unavailable')) {
    return {
      actionEvidence: 'ExtensionAction D1 is unavailable; audit absence cannot be established.',
      actionEvidenceState: 'unavailable'
    }
  }
  const count = grant.actionAudit?.length ?? 0
  return count
    ? {
        actionEvidence: `${count} exact-target ExtensionAction ${count === 1 ? 'row' : 'rows'}`,
        actionEvidenceState: 'known'
      }
    : {
        actionEvidence: 'No exact-target ExtensionAction row matched.',
        actionEvidenceState: 'unknown'
      }
}

export function buildPendingRows(data: Dataset): PendingAssignmentRow[] {
  return data.grants.flatMap(grant => {
    if (grant.siteMapping !== 'unmatched' || !grant.id) return []
    const mappingKind: PendingMappingKind = grant.marketplace?.length
      ? 'hostname_missing'
      : 'no_marketplace_row'
    const row: PendingAssignmentRow = {
      id: `pending:${grant.id}`,
      grantId: grant.id,
      eventId: `grant:${grant.id}:created`,
      cloudPrefix: grant.cloudId?.slice(0, 8) ?? 'unknown',
      space: grant.space,
      scope: grant.wide ? 'whole space' : 'one requester',
      status: grantStatusOf(grant),
      reviewBand: reviewBand(grant),
      mappingKind,
      mappingEvidence: mappingKind === 'hostname_missing'
        ? 'Marketplace licence context matched this cloud ID, but no site hostname is available.'
        : 'No Marketplace licence row matched this cloud ID in the current export.',
      createdAt: grant.createdAt ?? null,
      updatedAt: grant.updatedAt ?? null,
      expiresAt: grant.expiresAt ?? null,
      observedAt: grant.sourceObservedAt ?? null,
      origin: grant.activatedBy ?? grant.origin,
      ...requestEvidence(data, grant),
      ...actionEvidence(grant),
      unknowns: grant.unknowns ?? []
    }
    return [{ grant, row }]
  }).sort(compareRows).map(item => item.row)
}

export function summarizePending(rows: PendingAssignmentRow[]): PendingSummary {
  return {
    total: rows.length,
    active: rows.filter(row => row.status === 'active').length,
    unknown: rows.filter(row => row.status === 'unknown').length,
    expired: rows.filter(row => row.status === 'expired').length,
    inactive: rows.filter(row => row.status === 'inactive').length,
    withRequestEvidence: rows.filter(row => row.requestEvidenceState === 'known').length
  }
}
