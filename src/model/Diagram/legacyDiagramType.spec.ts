import { describe, it, expect } from 'vitest'
import { DiagramType } from './Diagram'
import { inferLegacyDiagramType, inferLegacySpecType, withLegacyDiagramType } from './legacyDiagramType'

// Verbatim shape of whimet4 custom content 376471593, which rendered as an
// empty card once placed: `code` plus the placeholder mermaidCode every old
// sequence body carried, and no diagramType.
const LEGACY_SEQUENCE = {
  title: 'Order Service',
  code: 'title Order Service\n@Lambda OrderController',
  styles: '{}',
  mermaidCode: 'graph TD; A-->B;',
}

describe('inferLegacyDiagramType', () => {
  it('follows the editor restore precedence: code, then mermaid, then plantuml', () => {
    expect(inferLegacyDiagramType(LEGACY_SEQUENCE)).toBe(DiagramType.Sequence)
    expect(inferLegacyDiagramType({ mermaidCode: 'graph LR; A-->B', plantUmlCode: '@startuml' }))
      .toBe(DiagramType.Mermaid)
    expect(inferLegacyDiagramType({ plantUmlCode: '@startuml' })).toBe(DiagramType.PlantUml)
  })

  it('infers nothing from an empty or non-object body', () => {
    expect(inferLegacyDiagramType({})).toBeUndefined()
    expect(inferLegacyDiagramType({ code: '', mermaidCode: '' })).toBeUndefined()
    expect(inferLegacyDiagramType(null)).toBeUndefined()
    expect(inferLegacyDiagramType('A->B')).toBeUndefined()
  })
})

describe('withLegacyDiagramType', () => {
  it('types a body that predates diagramType, keeping every field', () => {
    expect(withLegacyDiagramType(LEGACY_SEQUENCE)).toEqual({
      ...LEGACY_SEQUENCE,
      diagramType: DiagramType.Sequence,
    })
  })

  it('treats a stored Unknown like a missing type', () => {
    expect(withLegacyDiagramType({ diagramType: DiagramType.Unknown, mermaidCode: 'graph TD;' }).diagramType)
      .toBe(DiagramType.Mermaid)
  })

  it('never overrides a stated type', () => {
    const openapi = { diagramType: 'openapi', code: 'openapi: 3.0.0' }
    const mermaid = { diagramType: DiagramType.Mermaid, code: 'leftover', mermaidCode: 'graph TD;' }
    expect(withLegacyDiagramType(openapi)).toBe(openapi)
    expect(withLegacyDiagramType(mermaid)).toBe(mermaid)
  })

  it('returns a body with nothing to infer from unchanged', () => {
    const empty = { title: 'x' }
    expect(withLegacyDiagramType(empty)).toBe(empty)
    expect(withLegacyDiagramType(undefined)).toBeUndefined()
  })
})

describe('inferLegacySpecType', () => {
  it('reads the first statement of a YAML or JSON spec', () => {
    expect(inferLegacySpecType({ code: 'openapi: 3.0.0\ninfo:\n  title: x' })).toBe(DiagramType.OpenApi)
    expect(inferLegacySpecType({ code: 'swagger: "2.0"' })).toBe(DiagramType.OpenApi)
    expect(inferLegacySpecType({ code: 'asyncapi: 3.0.0' })).toBe(DiagramType.AsyncApi)
    // Pretty-printed JSON opens the object on its own line.
    expect(inferLegacySpecType({ code: '{\n  "openapi": "3.0.0"\n}' })).toBe(DiagramType.OpenApi)
  })

  it('skips leading blank lines, comments and a YAML document marker', () => {
    expect(inferLegacySpecType({ code: '\n# Orders API\n---\nopenapi: 3.0.0' })).toBe(DiagramType.OpenApi)
  })

  it('does not call a DSL body a spec because a later line looks like one', () => {
    // With a /m regex, `^` matched any line in the head.
    expect(inferLegacySpecType({ code: 'title Orders\nopenapi: Client.call()' })).toBeUndefined()
    expect(inferLegacySpecType({ code: 'A->B: hi\nasyncapi: B.reply()' })).toBeUndefined()
  })

  it('leaves the sequence viewer\'s rule alone: a spec body is not typed by withLegacyDiagramType', () => {
    // The sequence macro has no OpenAPI renderer; typing the body OpenAPI there
    // would mount nothing.
    expect(withLegacyDiagramType({ code: 'openapi: 3.0.0' }).diagramType).toBe(DiagramType.Sequence)
  })
})
