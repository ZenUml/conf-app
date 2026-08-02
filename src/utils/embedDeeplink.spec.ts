import { describe, it, expect } from 'vitest'
import {
  buildEmbedDeeplink,
  parseEmbedDeeplink,
  resolveLocalContentId,
  newlyCreatedId,
  buildDiagramDeeplink,
  parseDiagramDeeplink,
  resolveLocalTypedContentId,
} from './embedDeeplink'

const CLOUD = 'bc8bb5b3-09d2-4932-b68c-9b56fab8e34a'

describe('buildEmbedDeeplink', () => {
  it('builds the two-segment form the manifest matcher expects', () => {
    expect(buildEmbedDeeplink(CLOUD, '425987')).toBe(`https://confluence.zenuml.com/d/${CLOUD}/425987`)
  })

  it('refuses to build a link that could not resolve', () => {
    expect(buildEmbedDeeplink('', '425987')).toBeUndefined()
    expect(buildEmbedDeeplink(CLOUD, '')).toBeUndefined()
  })

  it('round-trips with the parser', () => {
    expect(parseEmbedDeeplink(buildEmbedDeeplink(CLOUD, '1'))).toEqual({ cloudId: CLOUD, contentId: '1' })
  })
})

describe('parseEmbedDeeplink', () => {
  it('reads both segments', () => {
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/425987`)).toEqual({
      cloudId: CLOUD,
      contentId: '425987',
    })
  })

  it('refuses shapes the matcher would not convert', () => {
    // The spike observed these staying plain links: http, and a single segment.
    expect(parseEmbedDeeplink(`http://confluence.zenuml.com/d/${CLOUD}/425987`)).toBeUndefined()
    expect(parseEmbedDeeplink('https://confluence.zenuml.com/d/425987')).toBeUndefined()
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/1/2`)).toBeUndefined()
    expect(parseEmbedDeeplink('https://evil.example.com/d/a/1')).toBeUndefined()
    expect(parseEmbedDeeplink('https://confluence.zenuml.com/new/sequence')).toBeUndefined()
  })

  it('is undefined for absent or malformed input', () => {
    expect(parseEmbedDeeplink(undefined)).toBeUndefined()
    expect(parseEmbedDeeplink('')).toBeUndefined()
    expect(parseEmbedDeeplink('not a url')).toBeUndefined()
    expect(parseEmbedDeeplink(7 as any)).toBeUndefined()
  })
})

describe('resolveLocalContentId', () => {
  it('resolves a link from this site', () => {
    expect(resolveLocalContentId(`https://confluence.zenuml.com/d/${CLOUD}/9`, CLOUD)).toBe('9')
  })

  it('refuses a link from another site rather than resolving a colliding id', () => {
    // Content ids are per-site integers: without this guard a link copied from
    // another tenant would render whatever local content shares that number.
    expect(resolveLocalContentId(`https://confluence.zenuml.com/d/other-cloud/9`, CLOUD)).toBeUndefined()
  })

  it('refuses when the current cloudId is unknown', () => {
    expect(resolveLocalContentId(`https://confluence.zenuml.com/d/${CLOUD}/9`, undefined)).toBeUndefined()
  })
})

describe('newlyCreatedId', () => {
  it('finds the id that appeared while the editor was open', () => {
    expect(newlyCreatedId(['1', '2'], ['1', '2', '3'])).toBe('3')
  })

  it('does not depend on ordering — identity is by id', () => {
    expect(newlyCreatedId(['2', '1'], ['3', '1', '2'])).toBe('3')
  })

  it('takes the last new one when a double save created several', () => {
    expect(newlyCreatedId(['1'], ['1', '2', '3'])).toBe('3')
  })

  it('is undefined when the user cancelled without saving', () => {
    expect(newlyCreatedId(['1', '2'], ['1', '2'])).toBeUndefined()
    expect(newlyCreatedId([], [])).toBeUndefined()
  })

  it('tolerates a failed listing on either side', () => {
    expect(newlyCreatedId(undefined as any, ['1'])).toBe('1')
    expect(newlyCreatedId(['1'], undefined as any)).toBeUndefined()
  })
})

describe('typed diagram deeplinks', () => {
  const TYPED = `https://confluence.zenuml.com/d/sequence/${CLOUD}/425987`

  it('builds a four-segment link per supported type', () => {
    expect(buildDiagramDeeplink('sequence', CLOUD, '425987')).toBe(TYPED)
    expect(buildDiagramDeeplink('graph', CLOUD, '1')).toBe(`https://confluence.zenuml.com/d/graph/${CLOUD}/1`)
  })

  it('refuses a type no macro declares a matcher for', () => {
    // A link nothing matches pastes as plain text — worse than not offering it.
    expect(buildDiagramDeeplink('asyncapi', CLOUD, '1')).toBeUndefined()
    expect(buildDiagramDeeplink('embed', CLOUD, '1')).toBeUndefined()
    expect(buildDiagramDeeplink('', CLOUD, '1')).toBeUndefined()
  })

  it('round-trips', () => {
    expect(parseDiagramDeeplink(TYPED)).toEqual({ type: 'sequence', cloudId: CLOUD, contentId: '425987' })
  })

  it('keeps the two forms apart by segment count', () => {
    // /d/*/* (embed, 3 segments) vs /d/<type>/*/* (real macro, 4). A matcher's
    // * covers exactly one segment, so neither pattern can catch the other.
    expect(parseDiagramDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/425987`)).toBeUndefined()
    expect(parseEmbedDeeplink(TYPED)).toBeUndefined()
  })

  it('resolves only same-site links', () => {
    expect(resolveLocalTypedContentId(TYPED, CLOUD)).toBe('425987')
    expect(resolveLocalTypedContentId(TYPED, 'another-cloud')).toBeUndefined()
    expect(resolveLocalTypedContentId(TYPED, undefined)).toBeUndefined()
  })
})
