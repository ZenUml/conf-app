import { afterEach, describe, expect, it, vi } from 'vitest'
import { placeholderDataset } from './placeholder'
import { loadExtensionsDataset } from './extensionsApi'
import type { ExtensionGrantRecord, ExtensionsResponse } from './extensionsContract'
import { buildEvents } from '@/lib/derive'

const source = (records: number) => ({
  state: 'ok' as const,
  records,
  detail: 'test source'
})

const openRequests = () => ({
  state: 'complete' as const,
  detail: 'test stream',
  rows: [],
  summary: {
    currentGrantObserved: 0,
    noCurrentGrantObserved: 0,
    insufficientEvidence: 0
  }
})

function grant(overrides: Partial<ExtensionGrantRecord>): ExtensionGrantRecord {
  return {
    id: 'grant_test',
    cloudId: 'cloud-test',
    domain: 'tenant-test',
    spaceKey: 'DEMO01',
    scope: 'space',
    userAccountId: null,
    storedStatus: 'inactive',
    status: 'inactive',
    statusDerivedAt: '2026-08-29T10:00:00.000Z',
    activatedBy: 'support:manual',
    ticketKey: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: '2026-09-20T00:00:00.000Z',
    marketplace: [],
    request: null,
    actionAudit: [],
    history: [],
    unknowns: [],
    unavailableReasons: {},
    ...overrides
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Extensions API frontend adapter', () => {
  it('retains incomplete records and preserves inactive/unknown status without expiry claims', async () => {
    const response: ExtensionsResponse = {
      contractVersion: 3,
      generatedAt: '2026-08-29T10:00:00.000Z',
      asOf: '2026-08-29',
      sources: {
        marketplace: source(1),
        jsm: source(0),
        space_license_kv: source(2),
        extension_action_d1: source(0)
      },
      summary: {
        grantCount: 2,
        activeCount: 0,
        expiredCount: 0,
        inactiveCount: 1,
        unknownStatusCount: 1,
        tenantCount: 1,
        auditedGrantCount: 0,
        matchedRequestCount: 0,
        originBuckets: []
      },
      openRequests: openRequests(),
      grants: [
        grant({ id: 'grant_inactive' }),
        grant({
          id: 'grant_unknown',
          status: 'unknown',
          storedStatus: 'unknown',
          activatedBy: null,
          createdAt: null,
          updatedAt: null,
          expiresAt: null,
          unknowns: ['grant expiry is missing or invalid'],
          unavailableReasons: {
            createdAt: 'KV grant createdAt is unavailable or invalid',
            updatedAt: 'KV grant updatedAt is unavailable or invalid',
            expiresAt: 'KV grant expiresAt is unavailable or invalid',
            activatedBy: 'KV grant activatedBy is unavailable'
          }
        })
      ]
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })))

    const result = await loadExtensionsDataset(placeholderDataset)

    expect(result.load).toMatchObject({ state: 'partial', incompleteGrantCount: 1 })
    expect(result.data.grants).toHaveLength(2)
    expect(result.data.grants.map(row => row.status)).toEqual(['inactive', 'unknown'])
    expect(result.data.grants[1]).toMatchObject({
      created: null,
      createdUnavailableReason: 'KV grant createdAt is unavailable or invalid',
      expires: null,
      expiresUnavailableReason: 'KV grant expiresAt is unavailable or invalid',
      origin: null,
      originUnavailableReason: 'KV grant activatedBy is unavailable'
    })
    expect(result.data.grants[0]).toMatchObject({
      updatedAt: '2026-08-20T00:00:00.000Z',
      siteMapping: 'matched'
    })
    expect(buildEvents(result.data).filter(event => event.kind === 'expired')).toHaveLength(0)
    expect(buildEvents(result.data).find(event => event.grant?.id === 'grant_unknown')).toMatchObject({
      tag: 'observed grant · createdAt unknown'
    })
  })

  it('marks an otherwise complete response partial when an optional source failed', async () => {
    const response: ExtensionsResponse = {
      contractVersion: 3,
      generatedAt: '2026-08-29T10:00:00.000Z',
      asOf: '2026-08-29',
      sources: {
        marketplace: { state: 'error', records: 0, detail: 'unavailable' },
        jsm: source(0),
        space_license_kv: source(1),
        extension_action_d1: source(0)
      },
      summary: {
        grantCount: 1,
        activeCount: 0,
        expiredCount: 0,
        inactiveCount: 1,
        unknownStatusCount: 0,
        tenantCount: 1,
        auditedGrantCount: 0,
        matchedRequestCount: 0,
        originBuckets: []
      },
      openRequests: openRequests(),
      grants: [grant({
        id: 'grant_partial',
        domain: null,
        unknowns: ['Marketplace site mapping is unavailable']
      })]
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })))

    const result = await loadExtensionsDataset(placeholderDataset)
    expect(result.load.state).toBe('partial')
    expect(result.load.sources?.marketplace.state).toBe('error')
    expect(result.data.grants[0]).toMatchObject({
      domain: null,
      domainUnavailableReason: 'Marketplace site mapping is unavailable'
    })
    expect(result.data.grants[0].siteMapping).toBe('unavailable')
  })

  it('carries source-backed open-request observations without substituting fixture requests', async () => {
    const response: ExtensionsResponse = {
      contractVersion: 3,
      generatedAt: '2026-08-29T10:00:00.000Z',
      asOf: '2026-08-29',
      sources: {
        marketplace: source(1),
        jsm: source(1),
        space_license_kv: source(0),
        extension_action_d1: source(0)
      },
      summary: {
        grantCount: 0, activeCount: 0, expiredCount: 0, inactiveCount: 0,
        unknownStatusCount: 0, tenantCount: 0, auditedGrantCount: 0,
        matchedRequestCount: 0, originBuckets: []
      },
      openRequests: {
        state: 'complete',
        detail: 'test stream',
        rows: [{
          ticketKey: 'ZEN-123', status: 'Waiting for support',
          createdAt: '2026-08-20T00:00:00.000Z', updatedAt: null,
          typedDomain: 'example', typedSpace: 'SPACE', currentGrant: 'not_observed',
          cloudId: 'cloud-example', requester: 'someone@example.com',
          macroCount: 128, macrosLimit: 100,
          macroCountRaw: '128', macrosLimitRaw: '100',
          priorGrants: { count: 0, activeCount: 0, latestExpiresAt: null, unavailableReason: null },
          comments: { state: 'known', publicCommentCount: 0, requesterCommentCount: 0,
            lastCommentAt: null, lastCommentAuthor: null, lastCommentAuthorship: 'unknown',
            lastCommentFirstLine: null, reason: null, unavailableReasons: {} },
          unavailableReasons: {}
        }],
        summary: { currentGrantObserved: 0, noCurrentGrantObserved: 1, insufficientEvidence: 0 }
      },
      grants: []
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200, headers: { 'content-type': 'application/json' }
    })))

    const result = await loadExtensionsDataset(placeholderDataset)
    expect(result.load.openRequests?.rows).toEqual(response.openRequests.rows)
    expect(result.load.openRequests?.summary.noCurrentGrantObserved).toBe(1)
  })

  it('marks a healthy missing Marketplace join as unmatched without turning unknown request fields into mismatches', async () => {
    const response: ExtensionsResponse = {
      contractVersion: 3,
      generatedAt: '2026-08-29T10:00:00.000Z',
      asOf: '2026-08-29',
      sources: {
        marketplace: source(1),
        jsm: source(1),
        space_license_kv: source(1),
        extension_action_d1: source(0)
      },
      summary: {
        grantCount: 1,
        activeCount: 0,
        expiredCount: 0,
        inactiveCount: 1,
        unknownStatusCount: 0,
        tenantCount: 1,
        auditedGrantCount: 0,
        matchedRequestCount: 1,
        originBuckets: []
      },
      openRequests: openRequests(),
      grants: [grant({
        id: 'grant_unmatched',
        domain: null,
        scope: 'user',
        userAccountId: 'kv-target-account',
        ticketKey: 'ZEN-999001',
        request: {
          ticketKey: 'ZEN-999001',
          status: 'Resolved',
          requester: null,
          requesterAccountId: null,
          targetUserAccountId: null,
          typedDomain: null,
          typedSpace: null,
          macroCount: 123,
          macrosLimit: 100,
          macroCountRaw: '00123',
          macrosLimitRaw: '0100',
          createdAt: '2026-08-19T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:00.000Z',
          matchedBy: 'ticket_key',
          comments: {
            state: 'known',
            publicCommentCount: 0,
            requesterCommentCount: 0,
            lastCommentAt: null,
            lastCommentAuthor: null,
            lastCommentAuthorship: 'unknown',
            lastCommentFirstLine: null,
            reason: null,
            unavailableReasons: {}
          },
          unavailableReasons: {
            requester: 'JSM reporter identity was unavailable',
            requesterAccountId: 'JSM reporter account id was unavailable',
            targetUserAccountId: 'JSM form User account ID was unavailable',
            typedDomain: 'JSM form Client domain was unavailable',
            typedSpace: 'JSM form Space key was unavailable',
            macroCount: 'JSM form Macro count was unavailable or non-numeric',
            macrosLimit: 'JSM form Limit was unavailable or non-numeric'
          }
        },
        unknowns: ['site domain is not available']
      })]
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })))

    const result = await loadExtensionsDataset(placeholderDataset)

    expect(result.data.grants[0].siteMapping).toBe('unmatched')
    expect(result.data.jsm['ZEN-999001'].note).toBe('')
    expect(result.data.jsm['ZEN-999001']).toMatchObject({
      requester: null,
      accountId: null,
      lastReply: null,
      typedDomain: null,
      typedSpace: null,
      replies: 0,
      macroCountRaw: '00123',
      macrosLimitRaw: '0100',
      unavailableReasons: {
        requester: 'JSM reporter identity was unavailable',
        accountId: 'JSM form User account ID was unavailable',
        typedDomain: 'JSM form Client domain was unavailable',
        typedSpace: 'JSM form Space key was unavailable'
      }
    })
  })
})
