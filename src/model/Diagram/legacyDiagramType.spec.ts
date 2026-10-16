import { describe, it, expect } from 'vitest'
import { DiagramType } from './Diagram'
import { inferLegacyDiagramType, withLegacyDiagramType } from './legacyDiagramType'

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
