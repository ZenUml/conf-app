import { describe, expect, it } from 'vitest'
import { buildSitesResponse } from './sitesData'

describe('buildSitesResponse', () => {
  it('groups Marketplace rows by cloud id and retains only known apps', () => {
    const response = buildSitesResponse([
      { cloudId: 'cloud-a', cloudSiteHostname: 'alpha.atlassian.net', addonKey: 'com.zenuml.confluence-addon-lite' },
      { cloudId: 'cloud-a', cloudSiteHostname: 'https://alpha.atlassian.net/wiki', addonKey: 'gptdock-confluence' },
      { cloudId: 'cloud-b', cloudSiteHostname: null, addonKey: 'unknown-addon' }
    ], '2026-08-30T00:00:00.000Z')

    expect(response.summary).toEqual({ siteCount: 2, licenseCount: 3, hostnameMissingCount: 1 })
    expect(response.sites).toEqual([
      { cloudId: 'cloud-a', domain: 'alpha', apps: ['dia', 'lite'], licenseRows: 2 },
      { cloudId: 'cloud-b', domain: null, apps: [], licenseRows: 1 }
    ])
  })
})
