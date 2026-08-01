import { describe, it, expect } from 'vitest'
import { buildNewDiagramLink, parseNewDiagramLink, readAutoConvertLink } from './newDiagramLink'
import { DiagramType } from '@/model/Diagram/Diagram'

describe('buildNewDiagramLink', () => {
  it('builds a link for every type the manifest declares a matcher for', () => {
    expect(buildNewDiagramLink(DiagramType.Sequence)).toBe('https://confluence.zenuml.com/new/sequence')
    expect(buildNewDiagramLink(DiagramType.Mermaid)).toBe('https://confluence.zenuml.com/new/mermaid')
    expect(buildNewDiagramLink(DiagramType.PlantUml)).toBe('https://confluence.zenuml.com/new/plantuml')
    expect(buildNewDiagramLink(DiagramType.Graph)).toBe('https://confluence.zenuml.com/new/graph')
    expect(buildNewDiagramLink(DiagramType.OpenApi)).toBe('https://confluence.zenuml.com/new/openapi')
  })

  it('returns undefined for a type with no matcher rather than a dead link', () => {
    // A URL with no matcher pastes as plain text, which would look like the
    // feature silently failing.
    expect(buildNewDiagramLink(DiagramType.AsyncApi)).toBeUndefined()
    expect(buildNewDiagramLink(DiagramType.Embed)).toBeUndefined()
    expect(buildNewDiagramLink('nonsense')).toBeUndefined()
  })

  it('round-trips with the parser', () => {
    for (const t of [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml, DiagramType.Graph, DiagramType.OpenApi]) {
      expect(parseNewDiagramLink(buildNewDiagramLink(t))).toBe(t)
    }
  })
})

describe('parseNewDiagramLink', () => {
  it('reads the type out of a well-formed link', () => {
    expect(parseNewDiagramLink('https://confluence.zenuml.com/new/mermaid')).toBe(DiagramType.Mermaid)
  })

  it('is case-insensitive on the type segment only', () => {
    expect(parseNewDiagramLink('https://confluence.zenuml.com/new/GRAPH')).toBe(DiagramType.Graph)
  })

  it('refuses http, matching the manifest which declares https matchers only', () => {
    expect(parseNewDiagramLink('http://confluence.zenuml.com/new/sequence')).toBeUndefined()
  })

  it('refuses another host', () => {
    expect(parseNewDiagramLink('https://evil.example.com/new/sequence')).toBeUndefined()
  })

  it('refuses the wrong path shape', () => {
    expect(parseNewDiagramLink('https://confluence.zenuml.com/new')).toBeUndefined()
    expect(parseNewDiagramLink('https://confluence.zenuml.com/new/sequence/extra')).toBeUndefined()
    expect(parseNewDiagramLink('https://confluence.zenuml.com/d/cloud/123')).toBeUndefined()
  })

  it('refuses an unknown type segment', () => {
    expect(parseNewDiagramLink('https://confluence.zenuml.com/new/spreadsheet')).toBeUndefined()
  })

  it('returns undefined for absent or malformed input, leaving behaviour untouched', () => {
    // The overwhelmingly common case: a macro that was not created by a paste
    // has no link at all.
    expect(parseNewDiagramLink(undefined)).toBeUndefined()
    expect(parseNewDiagramLink('')).toBeUndefined()
    expect(parseNewDiagramLink('not a url')).toBeUndefined()
    expect(parseNewDiagramLink(42 as any)).toBeUndefined()
  })
})

describe('readAutoConvertLink', () => {
  it('reads the documented config location', () => {
    expect(readAutoConvertLink({ extension: { config: { autoConvertLink: 'x' } } })).toBe('x')
  })

  it('reads the alternative shapes the spike must disambiguate', () => {
    expect(readAutoConvertLink({ extension: { autoConvertLink: 'y' } })).toBe('y')
    expect(readAutoConvertLink({ extension: { parameters: { autoConvertLink: 'z' } } })).toBe('z')
  })

  it('is undefined for an ordinary macro context', () => {
    expect(readAutoConvertLink({ extension: { config: { customContentId: '1' } } })).toBeUndefined()
    expect(readAutoConvertLink({})).toBeUndefined()
    expect(readAutoConvertLink(undefined)).toBeUndefined()
  })
})
