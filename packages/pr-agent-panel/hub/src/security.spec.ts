import { describe, expect, it } from 'vitest'
import {
  CHROME_EXTENSION_ORIGIN_PATTERN,
  createExtensionOriginPolicy,
  isAllowedExtensionOrigin,
  isAllowedWebSocketRequest,
} from './security'

const EXT = `chrome-extension://${'a'.repeat(32)}`
const OTHER = `chrome-extension://${'b'.repeat(32)}`

describe('security', () => {
  it('matches only 32-letter a-p extension ids', () => {
    expect(CHROME_EXTENSION_ORIGIN_PATTERN.test(EXT)).toBe(true)
    expect(CHROME_EXTENSION_ORIGIN_PATTERN.test(`chrome-extension://${'q'.repeat(32)}`)).toBe(false)
    expect(CHROME_EXTENSION_ORIGIN_PATTERN.test(`chrome-extension://${'a'.repeat(31)}`)).toBe(false)
    expect(CHROME_EXTENSION_ORIGIN_PATTERN.test('https://github.com')).toBe(false)
    expect(CHROME_EXTENSION_ORIGIN_PATTERN.test(`${EXT}/`)).toBe(false)
  })

  it('any-extension mode accepts any extension Origin and rejects web Origins', () => {
    const policy = createExtensionOriginPolicy('')
    expect(policy.mode).toBe('any-extension')
    expect(isAllowedExtensionOrigin(EXT, policy)).toBe(true)
    expect(isAllowedExtensionOrigin(EXT.toUpperCase().replace('CHROME-EXTENSION', 'chrome-extension'), policy)).toBe(true)
    expect(isAllowedExtensionOrigin('https://github.com', policy)).toBe(false)
    expect(isAllowedExtensionOrigin(undefined, policy)).toBe(false)
    expect(isAllowedExtensionOrigin('null', policy)).toBe(false)
  })

  it('exact mode accepts only listed Origins', () => {
    const policy = createExtensionOriginPolicy(` ${EXT} ,`)
    expect(policy.mode).toBe('exact')
    expect(isAllowedExtensionOrigin(EXT, policy)).toBe(true)
    expect(isAllowedExtensionOrigin(OTHER, policy)).toBe(false)
  })

  it('refuses an invalid allowlist entry', () => {
    expect(() => createExtensionOriginPolicy('https://evil.example')).toThrow(/Invalid allowed extension Origin/)
  })

  it('accepts only path "/" without a query', () => {
    const policy = createExtensionOriginPolicy()
    expect(isAllowedWebSocketRequest(EXT, '/', policy)).toBe(true)
    expect(isAllowedWebSocketRequest(EXT, '/ws', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(EXT, '/?token=1', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(EXT, '/?', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(EXT, '//evil.example/', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(EXT, undefined, policy)).toBe(false)
    expect(isAllowedWebSocketRequest('https://github.com', '/', policy)).toBe(false)
  })
})
