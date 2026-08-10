import { describe, it, expect } from 'vitest'
import { resolveZenumlRemoteBaseUrl } from './forgeGlobal'

// Guards the variant→backend-origin mapping used by callRemote/invokeRemote.
// The resolved origin MUST match the `connect` remote's baseUrl (manifest
// ${BACKEND_API_BASE_URL}) for each variant, or the Forge invocation token is
// rejected by the backend (symptom: AI Repair returns
// "Remote could not verify the Forge Invocation Token").
describe('resolveZenumlRemoteBaseUrl', () => {
  describe('asyncapi variant', () => {
    // Regression: asyncapi used to fall through to the FULL branch and hit
    // conf-stg-full, which is not its backend nor a declared remote.
    it('staging → conf-stg-lite (the shared Lite Pages project)', () => {
      expect(resolveZenumlRemoteBaseUrl('STAGING', { isAsyncApi: true })).toBe(
        'https://conf-stg-lite.zenuml.com',
      )
    })

    it('production → zenapi.zenuml.com (conf-lite custom domain, not conf-lite.zenuml.com)', () => {
      expect(resolveZenumlRemoteBaseUrl('PRODUCTION', { isAsyncApi: true })).toBe(
        'https://zenapi.zenuml.com',
      )
    })

    it('never resolves to a conf-*-full host', () => {
      for (const env of ['DEVELOPMENT', 'STAGING', 'PRODUCTION']) {
        expect(resolveZenumlRemoteBaseUrl(env, { isAsyncApi: true })).not.toContain('full')
      }
    })
  })

  describe('other variants are unchanged', () => {
    it('lite → conf-*-lite', () => {
      expect(resolveZenumlRemoteBaseUrl('STAGING', { isLite: true })).toBe(
        'https://conf-stg-lite.zenuml.com',
      )
      expect(resolveZenumlRemoteBaseUrl('PRODUCTION', { isLite: true })).toBe(
        'https://conf-lite.zenuml.com',
      )
    })

    it('diagramly is treated as lite', () => {
      expect(resolveZenumlRemoteBaseUrl('PRODUCTION', { isDiagramly: true })).toBe(
        'https://conf-lite.zenuml.com',
      )
    })

    it('full (no flags) → conf-*-full', () => {
      expect(resolveZenumlRemoteBaseUrl('STAGING', {})).toBe('https://conf-stg-full.zenuml.com')
      expect(resolveZenumlRemoteBaseUrl('PRODUCTION', {})).toBe('https://conf-full.zenuml.com')
    })
  })
})

// DEVELOPMENT used to resolve https://confluence-plugin.pages.dev, a Pages
// project no workflow deploys. It drifted out of date and stopped routing
// newer backend paths (/forge-upload-attachment answered 405 from the static
// handler), so every dev Forge environment silently lost them. These pin the
// two properties that matter: dev points somewhere CI actually deploys, and it
// agrees with the backend the whimet4 workflow declares in the manifest.
describe('resolveZenumlRemoteBaseUrl — DEVELOPMENT targets a maintained backend', () => {
  const DEPLOYED_BY_CI = [
    'https://conf-stg-lite.zenuml.com',
    'https://conf-stg-full.zenuml.com',
    'https://conf-lite.zenuml.com',
    'https://conf-full.zenuml.com',
    'https://zenapi.zenuml.com',
  ]

  it.each([
    ['lite', { isLite: true }],
    ['diagramly', { isDiagramly: true }],
    ['full', {}],
    ['asyncapi', { isAsyncApi: true }],
  ])('never sends %s dev traffic to an undeployed project', (_label, flags) => {
    const url = resolveZenumlRemoteBaseUrl('DEVELOPMENT', flags)
    expect(url).toBeDefined()
    expect(url).not.toContain('confluence-plugin.pages.dev')
    expect(DEPLOYED_BY_CI).toContain(url)
  })

  it('dev lite matches what the whimet4 workflow sets as BACKEND_API_BASE_URL', () => {
    // .github/workflows/deploy-whimet4.yml sets conf-stg-lite. A mismatch here
    // means invokeRemote cannot resolve a declared remote — the failure this
    // mapping caused in the first place.
    expect(resolveZenumlRemoteBaseUrl('DEVELOPMENT', { isLite: true }))
      .toBe('https://conf-stg-lite.zenuml.com')
  })

  it('keeps asyncapi off the full backend in dev, as in staging and prod', () => {
    expect(resolveZenumlRemoteBaseUrl('DEVELOPMENT', { isAsyncApi: true })).not.toContain('full')
  })
})
