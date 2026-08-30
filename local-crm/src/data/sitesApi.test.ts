import { describe, expect, it } from 'vitest'
import { sitesFromResponse } from './sitesApi'
import type { SitesResponse } from './sitesContract'
import { placeholderDataset } from './placeholder'

const response: SitesResponse = {
  contractVersion: 1,
  generatedAt: '2026-08-30T00:00:00.000Z',
  source: { state: 'ok', records: 1, detail: 'Marketplace licence export' },
  summary: { siteCount: 1, licenseCount: 1, hostnameMissingCount: 0 },
  sites: [{ cloudId: 'aa10f001', domain: 'example-01', apps: ['lite'], licenseRows: 1 }]
}

describe('sitesFromResponse', () => {
  it('joins current grants by cloud id without restoring fixture site rows', () => {
    const sites = sitesFromResponse(response, placeholderDataset)
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ domain: 'example-01', cloudId: 'aa10f001', extensions: '—' })
  })
})
