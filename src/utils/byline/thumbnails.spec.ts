import { describe, it, expect } from 'vitest'
import { indexThumbnails } from './thumbnails'

const att = (title: string, download: string | undefined, version?: number) => ({
  title,
  version: version === undefined ? undefined : { number: version },
  _links: { base: 'https://example.atlassian.net/wiki', download },
})

describe('indexThumbnails', () => {
  it('matches attachments to diagrams by the shared filename convention', () => {
    const out = indexThumbnails(
      [att('zenuml-111.png', '/download/attachments/9/zenuml-111.png?version=1', 1)],
      ['111'],
    )
    expect(out).toEqual([
      { customContentId: '111', path: '/wiki/download/attachments/9/zenuml-111.png?version=1' },
    ])
  })

  it('ignores attachments that belong to someone else', () => {
    // Pages carry user uploads and other apps' files; matching loosely would
    // put an arbitrary image next to a diagram title.
    const out = indexThumbnails(
      [
        att('holiday-photo.png', '/download/attachments/9/holiday-photo.png'),
        att('zenuml-999.png', '/download/attachments/9/zenuml-999.png'),
      ],
      ['111'],
    )
    expect(out).toEqual([])
  })

  it('picks the highest version so the thumbnail is not a stale capture', () => {
    const out = indexThumbnails(
      [
        att('zenuml-111.png', '/download/v1.png', 1),
        att('zenuml-111.png', '/download/v3.png', 3),
        att('zenuml-111.png', '/download/v2.png', 2),
      ],
      ['111'],
    )
    expect(out[0].path).toBe('/wiki/download/v3.png')
  })

  it('treats a missing version as oldest rather than throwing', () => {
    const out = indexThumbnails(
      [att('zenuml-111.png', '/download/no-version.png'), att('zenuml-111.png', '/download/v2.png', 2)],
      ['111'],
    )
    expect(out[0].path).toBe('/wiki/download/v2.png')
  })

  it('drops an attachment with no download link instead of building a 404 path', () => {
    expect(indexThumbnails([att('zenuml-111.png', undefined, 1)], ['111'])).toEqual([])
  })

  it('returns results in the caller order so rows line up', () => {
    const out = indexThumbnails(
      [att('zenuml-b.png', '/download/b.png', 1), att('zenuml-a.png', '/download/a.png', 1)],
      ['a', 'b'],
    )
    expect(out.map(r => r.customContentId)).toEqual(['a', 'b'])
  })

  it('omits diagrams that have no PNG — pre-backup and failed captures', () => {
    const out = indexThumbnails([att('zenuml-a.png', '/download/a.png', 1)], ['a', 'b'])
    expect(out.map(r => r.customContentId)).toEqual(['a'])
  })

  it('does not double-prefix a link that already carries /wiki', () => {
    const out = indexThumbnails([att('zenuml-a.png', '/wiki/download/a.png', 1)], ['a'])
    expect(out[0].path).toBe('/wiki/download/a.png')
  })

  it('tolerates empty, null and malformed input', () => {
    expect(indexThumbnails(null, ['a'])).toEqual([])
    expect(indexThumbnails([], ['a'])).toEqual([])
    expect(indexThumbnails([att('zenuml-a.png', '/d.png', 1)], [])).toEqual([])
    expect(indexThumbnails([{}, { title: undefined }] as any, ['a'])).toEqual([])
  })
})
