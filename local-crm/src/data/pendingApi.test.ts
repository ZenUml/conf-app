import { describe, expect, it } from 'vitest'
import { placeholderDataset } from './placeholder'
import {
  buildPendingDataset,
  buildPendingRows,
  pendingGrantMode,
  pendingPartialDetail
} from './pendingApi'
import { INITIAL_EXTENSIONS_LOAD, type ExtensionsLoadState } from './extensionsApi'
import type { Dataset, Grant } from './types'

type SourceName = 'marketplace' | 'jsm' | 'space_license_kv' | 'extension_action_d1'

function load(
  state: ExtensionsLoadState['state'],
  errors: SourceName[] = []
): ExtensionsLoadState {
  return {
    ...INITIAL_EXTENSIONS_LOAD,
    state,
    generatedAt: state === 'live' || state === 'partial'
      ? '2026-08-30T10:00:00.000Z'
      : null,
    sources: state === 'live' || state === 'partial'
      ? {
          marketplace: { state: errors.includes('marketplace') ? 'error' : 'ok', records: 3, detail: 'test' },
          jsm: { state: errors.includes('jsm') ? 'error' : 'ok', records: 2, detail: 'test' },
          space_license_kv: { state: errors.includes('space_license_kv') ? 'error' : 'ok', records: 4, detail: 'test' },
          extension_action_d1: { state: errors.includes('extension_action_d1') ? 'error' : 'ok', records: 0, detail: 'test' }
        }
      : null
  }
}

function grant(id: string, overrides: Partial<Grant> = {}): Grant {
  return {
    id,
    created: '20 Aug',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T11:00:00.000Z',
    domain: '(not in Marketplace · cloud example0)',
    siteMapping: 'unmatched',
    space: 'SPACE',
    origin: 'support:source-backed',
    activatedBy: 'support:source-backed',
    expires: '20 Sep',
    expiresAt: '2026-09-20T10:00:00.000Z',
    status: 'active',
    active: true,
    cloudId: `cloud-${id}`,
    userAccountId: `account-${id}`,
    storedStatus: 'active',
    sourceObservedAt: '2026-08-30T10:00:00.000Z',
    actionAudit: [],
    history: [],
    unknowns: ['site domain is not available', 'no ExtensionAction audit row exists'],
    marketplace: [],
    ...overrides
  }
}

function liveDataset(grants: Grant[]): Dataset {
  return {
    ...placeholderDataset,
    today: '2026-08-30',
    grants,
    jsm: {
      'ZEN-999001': {
        requester: 'Synthetic requester',
        accountId: 'synthetic-account',
        status: 'Resolved',
        lastReply: '29 Aug',
        replies: 2,
        typedDomain: 'requester-typed-example',
        typedSpace: 'SPACE',
        portalUnsigned: null,
        note: '',
        commentsKnown: true,
        publicComments: 2,
        matchedBy: 'ticket_key'
      }
    },
    origins: []
  }
}

describe('Pending assignment source contract', () => {
  it('requires both grant KV and Marketplace while retaining optional-source partials', () => {
    expect(pendingGrantMode(load('loading'))).toBe('loading')
    expect(pendingGrantMode(load('error'))).toBe('unavailable')
    expect(pendingGrantMode(load('partial', ['space_license_kv']))).toBe('unavailable')
    expect(pendingGrantMode(load('partial', ['marketplace']))).toBe('unavailable')
    expect(pendingGrantMode(load('partial', ['jsm']))).toBe('partial')
    expect(pendingGrantMode(load('partial', ['extension_action_d1']))).toBe('partial')
    expect(pendingGrantMode(load('live'))).toBe('live')
  })

  it('attributes every partial state to its actual evidence gap', () => {
    expect(pendingPartialDetail(load('partial', ['jsm'])))
      .toBe('JSM request evidence is unavailable.')
    expect(pendingPartialDetail(load('partial', ['extension_action_d1'])))
      .toBe('ExtensionAction audit evidence is unavailable.')
    expect(pendingPartialDetail({ ...load('partial'), incompleteGrantCount: 2 }))
      .toBe('2 current grant records have incomplete timestamp evidence.')
    expect(pendingPartialDetail({
      ...load('partial', ['jsm', 'extension_action_d1']),
      incompleteGrantCount: 1
    })).toBe(
      'JSM request evidence is unavailable. ExtensionAction audit evidence is unavailable. 1 current grant record has incomplete timestamp evidence.'
    )
  })

  it.each([
    load('loading'),
    load('error'),
    load('partial', ['space_license_kv']),
    load('partial', ['marketplace'])
  ])('never substitutes fixture grants when required evidence is unavailable', unavailable => {
    const result = buildPendingDataset(
      placeholderDataset,
      liveDataset([grant('live-unmapped')]),
      unavailable
    )

    expect(result.grants).toEqual([])
    expect(result.jsm).toEqual({})
    expect(buildPendingRows(result)).toEqual([])
    expect(result.registrations).toBe(placeholderDataset.registrations)
  })

  it('treats a healthy empty snapshot as authoritative', () => {
    const live = liveDataset([])
    const result = buildPendingDataset(placeholderDataset, live, load('live'))

    expect(result.grants).toBe(live.grants)
    expect(buildPendingRows(result)).toEqual([])
  })

  it('keeps live rows when JSM or D1 context is partial', () => {
    const live = liveDataset([grant('live-unmapped')])
    const result = buildPendingDataset(placeholderDataset, live, load('partial', ['jsm']))

    expect(result.grants).toBe(live.grants)
    expect(buildPendingRows(result)).toHaveLength(1)
  })

  it('projects only verified missing mappings and distinguishes the mapping evidence', () => {
    const rows = buildPendingRows(liveDataset([
      grant('no-row'),
      grant('hostname-missing', {
        marketplace: [{
          app: 'lite',
          licenseType: 'FREE',
          status: 'active',
          tier: '10 users',
          evaluationStartedAt: null,
          evaluationEndsAt: null
        }]
      }),
      grant('mapped', {
        domain: 'mapped-example',
        siteMapping: 'matched',
        unknowns: []
      }),
      grant('mapping-unavailable', {
        domain: '(site mapping unavailable · cloud example1)',
        siteMapping: 'unavailable',
        unknowns: ['Marketplace site mapping is unavailable']
      })
    ]))

    expect(rows.map(row => row.grantId)).toEqual(['hostname-missing', 'no-row'])
    expect(rows.map(row => row.mappingKind)).toEqual(['hostname_missing', 'no_marketplace_row'])
    expect(rows[0].mappingEvidence).toContain('licence context matched')
    expect(rows[1].mappingEvidence).toContain('No Marketplace licence row matched')
  })

  it('orders by observed KV state and evidence without inventing urgency', () => {
    const rows = buildPendingRows(liveDataset([
      grant('inactive', { status: 'inactive', active: false, storedStatus: 'inactive' }),
      grant('expired', {
        status: 'expired',
        active: false,
        ticketKey: 'ZEN-999001',
        requestTicket: 'ZEN-999001',
        requestMatchedBy: 'ticket_key',
        expires: '25 Aug',
        expiresAt: '2026-08-25T10:00:00.000Z'
      }),
      grant('unknown', { status: 'unknown', active: false, storedStatus: 'unknown' }),
      grant('active-no-ticket'),
      grant('active-ticket', {
        ticketKey: 'ZEN-999001',
        requestTicket: 'ZEN-999001',
        requestMatchedBy: 'ticket_key'
      })
    ]))

    expect(rows.map(row => row.grantId)).toEqual([
      'active-ticket',
      'active-no-ticket',
      'unknown',
      'expired',
      'inactive'
    ])
    expect(rows.map(row => row.reviewBand)).toEqual([
      'active',
      'active',
      'status unknown',
      'expired',
      'inactive'
    ])
    expect(rows[0].eventId).toBe('grant:active-ticket:created')
    expect(rows[0].requestEvidence).toContain('explicit ticket')
    expect(rows[1].requestEvidence).toContain('correlation cannot run')
  })
})
