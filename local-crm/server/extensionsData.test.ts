import { describe, expect, it } from 'vitest'
import { buildExtensionsResponse } from './extensionsData'

const DESCRIPTION = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Client domain: example.atlassian.net' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Space key: SPACE' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Macro count: 123' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Limit: 100' },
      { type: 'hardBreak' },
      { type: 'text', text: 'User account ID: target-account' }
    ]
  }]
}

function input() {
  return {
    generatedAt: '2026-08-29T00:00:00.000Z',
    marketplaceRows: [{
      addonKey: 'com.zenuml.confluence-addon-lite',
      cloudId: 'cloud-1',
      cloudSiteHostname: 'example.atlassian.net',
      status: 'active',
      licenseType: 'FREE',
      tier: '10 users'
    }],
    jsmIssues: [{
      key: 'ZEN-123',
      fields: {
        status: { name: 'Waiting for customer' },
        reporter: { displayName: 'Requester', accountId: 'reporter-account' },
        description: DESCRIPTION,
        created: '2026-08-20T00:00:00Z',
        updated: '2026-08-21T00:00:00Z'
      }
    }],
    jsmCommentsByTicket: new Map([['ZEN-123', [{
      author: { displayName: 'Requester', accountId: 'reporter-account' },
      created: '2026-08-21T00:00:00Z',
      jsdPublic: true
    }]]]),
    grantValues: [
      {
        key: 'license:cloud-1:SPACE:target-account',
        value: {
          cloudId: 'cloud-1',
          spaceKey: 'SPACE',
          userAccountId: 'target-account',
          status: 'active',
          activatedBy: 'support:temp:ZEN-123',
          createdAt: '2026-08-20T00:00:00Z',
          updatedAt: '2026-08-20T00:00:00Z',
          expiresAt: '2026-09-01T00:00:00Z'
        }
      },
      {
        key: 'license:cloud-1:SPACE',
        value: {
          cloudId: 'cloud-1',
          spaceKey: 'SPACE',
          status: 'active',
          activatedBy: 'experiment:test',
          createdAt: '2026-08-20T00:00:00Z',
          updatedAt: '2026-08-20T00:00:00Z',
          expiresAt: '2026-08-28T00:00:00Z'
        }
      }
    ],
    actionRows: [
      {
        ticketKey: 'ZEN-123',
        action: 'initial',
        status: 'applied',
        cloudId: 'cloud-1',
        spaceKey: 'SPACE',
        userAccountId: 'target-account',
        macroCount: 123,
        expiresAt: '2026-09-01T00:00:00Z',
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z'
      },
      {
        ticketKey: 'ZEN-123',
        action: 'feedback',
        status: 'applied',
        cloudId: 'cloud-1',
        spaceKey: 'SPACE',
        userAccountId: 'target-account',
        macroCount: 124,
        expiresAt: '2026-10-01T00:00:00Z',
        createdAt: '2026-08-21T00:00:00Z',
        updatedAt: '2026-08-21T00:00:00Z'
      },
      {
        ticketKey: 'ZEN-999',
        action: 'initial',
        status: 'applied',
        cloudId: 'cloud-1',
        spaceKey: 'SPACE',
        userAccountId: 'target-account',
        macroCount: 123,
        expiresAt: '2026-09-01T00:00:00Z',
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z'
      }
    ]
  }
}

describe('Extensions API transformer', () => {
  it('joins KV to Marketplace, JSM, comments and exact-scope action audit', () => {
    const response = buildExtensionsResponse(input())
    const userGrant = response.grants.find(row => row.scope === 'user')
    const spaceGrant = response.grants.find(row => row.scope === 'space')

    expect(response.summary).toMatchObject({
      grantCount: 2,
      activeCount: 1,
      expiredCount: 1,
      tenantCount: 1,
      auditedGrantCount: 1
    })
    expect(userGrant).toMatchObject({
      domain: 'example',
      ticketKey: 'ZEN-123',
      status: 'active',
      userAccountId: 'target-account'
    })
    expect(userGrant?.request).toMatchObject({
      targetUserAccountId: 'target-account',
      macroCount: 123,
      macrosLimit: 100,
      matchedBy: 'ticket_key',
      comments: {
        state: 'known',
        publicCommentCount: 1,
        requesterCommentCount: 1,
        lastCommentAuthorship: 'requester'
      }
    })
    expect(userGrant?.actionAudit).toHaveLength(1)
    expect(spaceGrant?.actionAudit).toHaveLength(0)
  })

  it('keeps missing sources explicit instead of manufacturing evidence', () => {
    const base = input()
    const response = buildExtensionsResponse({
      ...base,
      marketplaceRows: [],
      jsmIssues: [],
      jsmCommentsByTicket: new Map(),
      actionRows: [],
      sourceErrors: {
        marketplace: 'Marketplace unavailable',
        jsm: 'JSM unavailable',
        extension_action_d1: 'D1 unavailable'
      }
    })
    const grant = response.grants[0]
    expect(response.sources.marketplace.state).toBe('error')
    expect(response.sources.jsm.state).toBe('error')
    expect(grant.domain).toBeNull()
    expect(grant.request).toBeNull()
    expect(grant.unknowns).toEqual(expect.arrayContaining([
      'Marketplace site mapping is unavailable',
      'JSM request matching is unavailable',
      'ExtensionAction audit source is unavailable'
    ]))
  })

  it('does not attach a later JSM request through the domain + space fallback', () => {
    const base = input()
    const response = buildExtensionsResponse({
      ...base,
      grantValues: [{
        key: 'license:cloud-1:SPACE:target-account',
        value: {
          cloudId: 'cloud-1',
          spaceKey: 'SPACE',
          status: 'active',
          userAccountId: 'target-account',
          activatedBy: 'support:temp-14d-extension',
          createdAt: '2026-08-01T00:00:00Z',
          updatedAt: '2026-08-01T00:00:00Z',
          expiresAt: '2026-09-01T00:00:00Z'
        }
      }],
      jsmIssues: [{
        key: 'ZEN-999',
        fields: {
          status: { name: 'Waiting for support' },
          reporter: { displayName: 'Requester', accountId: 'reporter-account' },
          description: DESCRIPTION,
          created: '2026-08-29T00:00:00Z',
          updated: '2026-08-29T00:00:00Z'
        }
      }],
      jsmCommentsByTicket: new Map(),
      actionRows: []
    })

    expect(response.grants[0].request).toBeNull()
    expect(response.summary.matchedRequestCount).toBe(0)
  })

  it('requires exact scope and target for a domain + space fallback', () => {
    const base = input()
    const response = buildExtensionsResponse({
      ...base,
      grantValues: [
        {
          key: 'license:cloud-1:SPACE:target-account',
          value: {
            status: 'active',
            activatedBy: 'support:manual',
            createdAt: '2026-08-22T00:00:00Z',
            updatedAt: '2026-08-22T00:00:00Z',
            expiresAt: '2026-09-01T00:00:00Z'
          }
        },
        {
          key: 'license:cloud-1:SPACE',
          value: {
            status: 'active',
            activatedBy: 'support:manual',
            createdAt: '2026-08-22T00:00:00Z',
            updatedAt: '2026-08-22T00:00:00Z',
            expiresAt: '2026-09-01T00:00:00Z'
          }
        }
      ]
    })

    const userGrant = response.grants.find(row => row.scope === 'user')
    const spaceGrant = response.grants.find(row => row.scope === 'space')
    expect(userGrant?.request).toMatchObject({ ticketKey: 'ZEN-123', matchedBy: 'domain_space' })
    expect(userGrant?.ticketKey).toBeNull()
    expect(userGrant?.actionAudit).toHaveLength(0)
    expect(spaceGrant?.request).toBeNull()
    expect(response.summary.matchedRequestCount).toBe(1)
  })

  it('treats the KV key as the grant target and surfaces duplicated-value drift', () => {
    const base = input()
    const response = buildExtensionsResponse({
      ...base,
      grantValues: [{
        key: 'license:cloud-1:SPACE:target-account',
        value: {
          cloudId: 'different-cloud',
          spaceKey: 'OTHER',
          userAccountId: 'different-account',
          status: 'active',
          activatedBy: 'support:temp:ZEN-123',
          createdAt: '2026-08-20T00:00:00Z',
          updatedAt: '2026-08-20T00:00:00Z',
          expiresAt: '2026-09-01T00:00:00Z'
        }
      }]
    })

    expect(response.grants[0]).toMatchObject({
      cloudId: 'cloud-1',
      spaceKey: 'SPACE',
      scope: 'user',
      userAccountId: 'target-account'
    })
    expect(response.grants[0].unknowns).toEqual(expect.arrayContaining([
      'KV value cloudId differs from the authoritative key',
      'KV value spaceKey differs from the authoritative key',
      'KV value user scope differs from the authoritative key'
    ]))
  })

  it('preserves active, expired, inactive and unknown states including null timestamps', () => {
    const base = input()
    const response = buildExtensionsResponse({
      ...base,
      jsmIssues: [],
      jsmCommentsByTicket: new Map(),
      actionRows: [],
      grantValues: [
        { key: 'license:cloud-1:A', value: { status: 'active', createdAt: '2026-08-20T00:00:00Z', expiresAt: '2026-09-01T00:00:00Z' } },
        { key: 'license:cloud-1:B', value: { status: 'active', createdAt: '2026-08-20T00:00:00Z', expiresAt: '2026-08-28T00:00:00Z' } },
        { key: 'license:cloud-1:C', value: { status: 'inactive', createdAt: '2026-08-20T00:00:00Z', expiresAt: '2026-09-01T00:00:00Z' } },
        { key: 'license:cloud-1:D', value: { status: 'mystery', createdAt: '2026-08-20T00:00:00Z', expiresAt: '2026-09-01T00:00:00Z' } },
        { key: 'license:cloud-1:E', value: { status: 'active', createdAt: null, expiresAt: null } }
      ]
    })

    expect(response.grants.map(row => row.status)).toEqual([
      'active', 'expired', 'inactive', 'unknown', 'unknown'
    ])
    expect(response.grants.at(-1)).toMatchObject({ createdAt: null, expiresAt: null })
    expect(response.summary).toMatchObject({
      grantCount: 5,
      activeCount: 1,
      expiredCount: 1,
      inactiveCount: 1,
      unknownStatusCount: 2
    })
  })
})
