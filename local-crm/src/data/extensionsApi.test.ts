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
    ...overrides
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Extensions API frontend adapter', () => {
  it('retains incomplete records and preserves inactive/unknown status without expiry claims', async () => {
    const response: ExtensionsResponse = {
      contractVersion: 1,
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
      grants: [
        grant({ id: 'grant_inactive' }),
        grant({
          id: 'grant_unknown',
          status: 'unknown',
          storedStatus: 'unknown',
          createdAt: null,
          updatedAt: null,
          expiresAt: null,
          unknowns: ['grant expiry is missing or invalid']
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
    expect(buildEvents(result.data).filter(event => event.kind === 'expired')).toHaveLength(0)
    expect(buildEvents(result.data).find(event => event.grant?.id === 'grant_unknown')).toMatchObject({
      tag: 'observed grant · createdAt unknown'
    })
  })

  it('marks an otherwise complete response partial when an optional source failed', async () => {
    const response: ExtensionsResponse = {
      contractVersion: 1,
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
      grants: [grant({ id: 'grant_partial' })]
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })))

    const result = await loadExtensionsDataset(placeholderDataset)
    expect(result.load.state).toBe('partial')
    expect(result.load.sources?.marketplace.state).toBe('error')
  })
})
