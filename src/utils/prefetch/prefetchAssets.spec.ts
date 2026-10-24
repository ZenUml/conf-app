import { describe, it, expect, beforeEach } from 'vitest'
import { prefetchUrls, fetchPrefetchManifest } from './prefetchAssets'

function injectedLinks(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll('link[rel="prefetch"]')] as HTMLLinkElement[]
}

beforeEach(() => {
  document.head.querySelectorAll('link[rel="prefetch"]').forEach((l) => l.remove())
})

describe('prefetchUrls', () => {
  it('resolves immediately for an empty list', async () => {
    const result = await prefetchUrls([])
    expect(result).toEqual({ requested: 0, failed: 0, timedOut: false })
  })

  it('injects prefetch links with as= derived from the extension', async () => {
    const pending = prefetchUrls(['drawio/js/viewer-static.min.js', 'drawio/mxgraph/css/common.css'])
    const links = injectedLinks()
    expect(links).toHaveLength(2)
    expect(links[0].as).toBe('script')
    expect(links[1].as).toBe('style')
    expect(links[0].href).toBe(new URL('drawio/js/viewer-static.min.js', document.baseURI).href)
    links.forEach((l) => l.onload?.(new Event('load')))
    const result = await pending
    expect(result).toEqual({ requested: 2, failed: 0, timedOut: false })
  })

  it('counts errored links as failed', async () => {
    const pending = prefetchUrls(['a.js', 'b.js'])
    const [a, b] = injectedLinks()
    a.onload?.(new Event('load'))
    b.onerror?.(new Event('error'))
    const result = await pending
    expect(result).toEqual({ requested: 2, failed: 1, timedOut: false })
  })

  it('skips an already-injected identical href', async () => {
    const first = prefetchUrls(['a.js'])
    injectedLinks().forEach((l) => l.onload?.(new Event('load')))
    await first
    const second = await prefetchUrls(['a.js'])
    expect(second.requested).toBe(0)
    expect(injectedLinks()).toHaveLength(1)
  })

  it('resolves with timedOut when links never settle', async () => {
    const result = await prefetchUrls(['never.js'], { timeoutMs: 10 })
    expect(result.timedOut).toBe(true)
    expect(result.requested).toBe(1)
  })
})

describe('fetchPrefetchManifest', () => {
  const okJson = (body: unknown, contentType = 'application/json') =>
    (async () =>
      ({
        ok: true,
        headers: { get: () => contentType },
        json: async () => body,
      }) as unknown as Response) as unknown as typeof fetch

  it('returns the manifest for valid JSON', async () => {
    const manifest = await fetchPrefetchManifest({
      fetchFn: okJson({ version: 1, renderers: { sequence: ['assets/zenuml.esm-abc.js'] } }),
      baseUri: 'https://cdn.example/bundle/',
    })
    expect(manifest.renderers.sequence).toEqual(['assets/zenuml.esm-abc.js'])
  })

  it('returns empty for the SPA HTML fallback (200 text/html)', async () => {
    const manifest = await fetchPrefetchManifest({
      fetchFn: okJson('<html></html>', 'text/html'),
      baseUri: 'https://cdn.example/bundle/',
    })
    expect(manifest.renderers).toEqual({})
  })

  it.each([
    ['non-OK response', (async () => ({ ok: false, headers: { get: () => 'application/json' } })) as unknown as typeof fetch],
    ['fetch throws', (async () => { throw new Error('offline') }) as unknown as typeof fetch],
  ])('returns empty when %s', async (_name, fetchFn) => {
    const manifest = await fetchPrefetchManifest({ fetchFn, baseUri: 'https://cdn.example/bundle/' })
    expect(manifest.renderers).toEqual({})
  })

  it('returns empty for an unexpected schema', async () => {
    const manifest = await fetchPrefetchManifest({
      fetchFn: okJson({ version: 2, whatever: true }),
      baseUri: 'https://cdn.example/bundle/',
    })
    expect(manifest.renderers).toEqual({})
  })
})
