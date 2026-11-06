import { describe, it, expect } from 'vitest'
import { applyNewDiagramLink, applyRequestedDiagramType, buildNewDiagramLink, diagramTypeFromModalType, parseNewDiagramLink, readAutoConvertLink } from './newDiagramLink'
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

describe('applyNewDiagramLink', () => {
  const LINK = 'https://confluence.zenuml.com/new/mermaid'

  it('retypes the sequence family placeholder — the case the first version missed', () => {
    // forgeIndex assigns this doc before seeding runs; guarding on "no doc"
    // skipped exactly the family the feature exists for.
    const placeholder = {
      diagramType: DiagramType.Sequence,
      code: 'seq example',
      mermaidCode: 'graph TD;',
      plantUmlCode: '@startuml',
      isNew: true,
    }
    const { doc, seededType } = applyNewDiagramLink(placeholder, LINK, false)
    expect(seededType).toBe(DiagramType.Mermaid)
    expect(doc!.diagramType).toBe(DiagramType.Mermaid)
  })

  it('keeps the example bodies and the isNew flag rather than replacing the doc', () => {
    const placeholder = { diagramType: DiagramType.Sequence, mermaidCode: 'graph TD;', isNew: true }
    const { doc } = applyNewDiagramLink(placeholder, LINK, false)
    expect(doc).toMatchObject({ mermaidCode: 'graph TD;', isNew: true })
  })

  it('creates a doc for the types that arrive without one (graph, openapi)', () => {
    const { doc, seededType } = applyNewDiagramLink(undefined, 'https://confluence.zenuml.com/new/graph', false)
    expect(seededType).toBe(DiagramType.Graph)
    expect(doc!.diagramType).toBe(DiagramType.Graph)
  })

  it("never retypes a macro that has stored content", () => {
    const stored = { diagramType: DiagramType.Sequence, code: 'real diagram' }
    const { doc, seededType } = applyNewDiagramLink(stored, LINK, true)
    expect(seededType).toBeUndefined()
    expect(doc).toBe(stored)
  })

  it('leaves an ordinary insert untouched when there is no link', () => {
    const placeholder = { diagramType: DiagramType.Sequence, isNew: true }
    const { doc, seededType } = applyNewDiagramLink(placeholder, undefined, false)
    expect(seededType).toBeUndefined()
    expect(doc).toBe(placeholder)
  })
})

describe('diagramTypeFromModalType / applyRequestedDiagramType', () => {
  it('maps the routing vocabulary back to storage types', () => {
    expect(diagramTypeFromModalType('mermaid')).toBe(DiagramType.Mermaid)
    expect(diagramTypeFromModalType('graph')).toBe(DiagramType.Graph)
    expect(diagramTypeFromModalType('openapi')).toBe(DiagramType.OpenApi)
    expect(diagramTypeFromModalType('nonsense')).toBeUndefined()
    expect(diagramTypeFromModalType(undefined)).toBeUndefined()
  })

  it('retypes the placeholder so Flowchart does not open a sequence editor', () => {
    const placeholder = { diagramType: DiagramType.Sequence, mermaidCode: 'graph TD;', isNew: true }
    const { doc, seededType } = applyRequestedDiagramType(placeholder, DiagramType.Mermaid, false)
    expect(seededType).toBe(DiagramType.Mermaid)
    expect(doc).toMatchObject({ diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD;', isNew: true })
  })

  it('never touches a macro that already has stored content', () => {
    const stored = { diagramType: DiagramType.Sequence }
    expect(applyRequestedDiagramType(stored, DiagramType.Graph, true).doc).toBe(stored)
  })

  it('is a no-op when nothing was requested', () => {
    const placeholder = { diagramType: DiagramType.Sequence }
    expect(applyRequestedDiagramType(placeholder, undefined, false).doc).toBe(placeholder)
  })
})
