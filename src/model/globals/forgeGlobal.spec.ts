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
