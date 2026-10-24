import { describe, expect, it } from 'vitest'
import { MARKETPLACE_TECHNICAL_CONTACT_LABEL, sitesFromResponse } from './sitesApi'
import type { SitesResponse } from './sitesContract'
import { placeholderDataset } from './placeholder'
import type { LifecycleResponse } from './lifecycleContract'

const response: SitesResponse = {
  contractVersion: 1,
  generatedAt: '2026-08-30T00:00:00.000Z',
  source: { state: 'ok', records: 1, detail: 'Marketplace licence export' },
  summary: { siteCount: 1, licenseCount: 1, hostnameMissingCount: 0 },
  sites: [{ cloudId: 'aa10f001', domain: 'example-01', apps: ['lite'], licenseRows: 1 }]
}

describe('sitesFromResponse', () => {
  it('keeps the displayed contact semantics explicit', () => {
    expect(MARKETPLACE_TECHNICAL_CONTACT_LABEL).toBe('Marketplace technical contact — not a confirmed Site Contact')
  })
  it('joins current grants by cloud id without restoring fixture site rows', () => {
    const sites = sitesFromResponse(response, placeholderDataset)
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ domain: 'example-01', cloudId: 'aa10f001', extensions: '—' })
  })

  it('attaches only Marketplace technical contacts for the same cloud id', () => {
    const lifecycle = {
      contacts: [
        { id: 'lite:alpha@example.test', email: 'alpha@example.test', cloudId: 'aa10f001' },
        { id: 'lite:other@example.test', email: 'other@example.test', cloudId: 'other-cloud' }
      ]
    } as LifecycleResponse

    const [site] = sitesFromResponse(response, placeholderDataset, lifecycle)
    expect(site.technicalContacts).toEqual(['alpha@example.test'])
    expect(site.technicalContacts).not.toContain('other@example.test')
  })

  it('leaves Marketplace sites without a same-cloud technical contact empty', () => {
    const lifecycle = { contacts: [{ id: 'x', email: 'other@example.test', cloudId: 'other-cloud' }] } as LifecycleResponse
    expect(sitesFromResponse(response, placeholderDataset, lifecycle)[0].technicalContacts).toEqual([])
  })
})
