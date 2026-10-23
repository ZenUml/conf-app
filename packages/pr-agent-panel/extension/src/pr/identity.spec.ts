import { describe, expect, it } from 'vitest'
import { parsePrRef, parseRepoRef, readHeadSha, readPrState, readTitle } from './identity'
import fixture from './__fixtures__/pr-page.html?raw'

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html')

describe('parsePrRef', () => {
  it('parses a PR conversation URL with a canonical url', () => {
    expect(parsePrRef('https://github.com/ZenUml/conf-app/pull/856')).toEqual({
      host: 'github.com',
      owner: 'ZenUml',
      repo: 'conf-app',
      number: 856,
      url: 'https://github.com/ZenUml/conf-app/pull/856',
    })
  })

  it('parses sub-pages and drops query and hash from the canonical url', () => {
    const ref = parsePrRef('https://github.com/o/r/pull/5/files?diff=split#diff-abc')
    expect(ref?.number).toBe(5)
    expect(ref?.url).toBe('https://github.com/o/r/pull/5')
    expect(ref?.headSha).toBeUndefined()
  })

  it('takes headSha from a /commits/<sha> URL', () => {
    expect(parsePrRef('https://github.com/o/r/pull/5/commits/ABC1234')?.headSha).toBe('abc1234')
    expect(parsePrRef('https://github.com/o/r/pull/5/commits')?.headSha).toBeUndefined()
    expect(parsePrRef('https://github.com/o/r/pull/5/commits/not-a-sha')?.headSha).toBeUndefined()
  })

  it('returns null for the PR list and for non-PR pages', () => {
    expect(parsePrRef('https://github.com/o/r/pulls')).toBeNull()
    expect(parsePrRef('https://github.com/o/r/pulls?q=is%3Aopen')).toBeNull()
    expect(parsePrRef('https://github.com/o/r/issues/5')).toBeNull()
    expect(parsePrRef('https://github.com/o/r/pull/abc')).toBeNull()
    expect(parsePrRef('https://github.com/o/r/pull/0')).toBeNull()
    expect(parsePrRef('http://github.com/o/r/pull/5')).toBeNull()
    expect(parsePrRef('not a url')).toBeNull()
  })

  it('parseRepoRef accepts /pulls and PR pages only', () => {
    expect(parseRepoRef('https://github.com/o/r/pulls')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
    expect(parseRepoRef('https://github.com/o/r/pull/9/files')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
    expect(parseRepoRef('https://github.com/o/r')).toBeNull()
  })
})

describe('title', () => {
  it('prefers .js-issue-title, then bdi.js-issue-title, then PH_Title h1', () => {
    expect(readTitle(doc('<h1><span class="js-issue-title"> Classic  title </span></h1>'))).toBe('Classic title')
    expect(readTitle(doc('<bdi class="js-issue-title">Bdi title</bdi>'))).toBe('Bdi title')
    expect(readTitle(doc('<div data-component="PH_Title"><h1>React title</h1></div>'))).toBe('React title')
    expect(
      readTitle(doc('<span class="js-issue-title">First</span><div data-component="PH_Title"><h1>Second</h1></div>')),
    ).toBe('First')
  })

  it('reads the 2026 React layout title from the fixture', () => {
    expect(readTitle(doc(fixture))).toBe('Example pull request title')
  })

  it('attaches the title when a document is given and caps it at 300 chars', () => {
    const long = 'x'.repeat(400)
    const ref = parsePrRef('https://github.com/o/r/pull/1', doc(`<span class="js-issue-title">${long}</span>`))
    expect(ref?.title).toHaveLength(300)
    expect(parsePrRef('https://github.com/o/r/pull/1', doc('<p>nothing</p>'))?.title).toBeUndefined()
  })
})

describe('headSha and state from the page', () => {
  it('reads a .sha next to the head ref', () => {
    expect(readHeadSha(doc('<span class="commit-ref">a:b</span><code class="sha">1234abc</code>'))).toBe('1234abc')
  })

  it('reads headSha from the React app embedded JSON', () => {
    const sha = '436718b258b7a96f9134e550ebef4a477beb9506'
    const d = doc(`<script type="application/json" data-target="react-app.embeddedData">{"payload":{"headSha":"${sha}"}}</script>`)
    expect(readHeadSha(d)).toBe(sha)
    expect(parsePrRef('https://github.com/o/r/pull/1', d)?.headSha).toBe(sha)
  })

  it('ignores embedded data rendered for another PR (stale after a soft navigation)', () => {
    const sha = '436718b258b7a96f9134e550ebef4a477beb9506'
    const html = (path: string) =>
      `<react-app initial-path="${path}"><script type="application/json" data-target="react-app.embeddedData">{"headSha":"${sha}"}</script></react-app>`
    expect(parsePrRef('https://github.com/o/r/pull/7', doc(html('/o/r/pull/6')))?.headSha).toBeUndefined()
    expect(parsePrRef('https://github.com/o/r/pull/7', doc(html('/o/r/pull/7/files')))?.headSha).toBe(sha)
    expect(parsePrRef('https://github.com/o/r/pull/7', doc(html('/o/r/pull/70')))?.headSha).toBeUndefined()
  })

  it('returns undefined when the page shows no head', () => {
    expect(readHeadSha(doc(fixture))).toBeUndefined()
  })

  it('maps the header state label', () => {
    expect(readPrState(doc(fixture))).toBe('merged')
    expect(readPrState(doc('<span data-component="StateLabel" data-status="pullOpened">Open</span>'))).toBe('open')
    expect(readPrState(doc('<span data-component="StateLabel" data-status="draft">Draft</span>'))).toBe('draft')
    expect(readPrState(doc('<span class="State" title="Status: Closed">Closed</span>'))).toBe('closed')
    expect(readPrState(doc('<p></p>'))).toBe('unknown')
  })
})
