import { describe, it, expect } from 'vitest'
import { derivePageUrl } from '@/model/asyncapi/derivePageUrl'

describe('derivePageUrl', () => {
  it('joins base + webui into an absolute page URL', () => {
    const page = {
      _links: {
        base: 'https://example.atlassian.net/wiki',
        webui: '/spaces/API/pages/123/My+Spec',
      },
    }
    expect(derivePageUrl(page)).toBe(
      'https://example.atlassian.net/wiki/spaces/API/pages/123/My+Spec',
    )
  })

  it('returns undefined when base is missing (fall back to dead text, not a broken link)', () => {
    expect(derivePageUrl({ _links: { webui: '/spaces/API/pages/123/X' } })).toBeUndefined()
  })

  it('returns undefined when webui is missing', () => {
    expect(derivePageUrl({ _links: { base: 'https://example.atlassian.net/wiki' } })).toBeUndefined()
  })

  it('returns undefined when _links is absent / page is null', () => {
    expect(derivePageUrl({})).toBeUndefined()
    expect(derivePageUrl(null)).toBeUndefined()
    expect(derivePageUrl(undefined)).toBeUndefined()
  })
})
