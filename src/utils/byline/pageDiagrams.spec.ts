import { describe, it, expect } from 'vitest'
import { parsePageDiagrams, summarizeDiagrams, typeLabel } from './pageDiagrams'
import { DiagramType } from '@/model/Diagram/Diagram'

const child = (id: string, title: string, body: any) => ({
  id,
  title,
  body: { raw: { value: typeof body === 'string' ? body : JSON.stringify(body) } },
})

const ok = (...children: any[]) => ({ results: children })

describe('parsePageDiagrams', () => {
  it('lists diagrams across every probed content type', () => {
    const out = parsePageDiagrams([
      ok(child('1', 'Login flow', { diagramType: DiagramType.Sequence, code: 'A->B: hi' })),
      ok(child('2', 'Architecture', { diagramType: DiagramType.Graph, graphXml: '<mxfile/>' })),
    ])
    expect(out.map(d => d.id)).toEqual(['1', '2'])
    expect(out[0].title).toBe('Login flow')
    expect(out[1].diagramType).toBe(DiagramType.Graph)
  })

  it('extracts source per type and only marks text DSLs copyable', () => {
    const out = parsePageDiagrams([
      ok(
        child('1', 'seq', { diagramType: DiagramType.Sequence, code: 'A->B: hi' }),
        child('2', 'mmd', { diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD;' }),
        child('3', 'puml', { diagramType: DiagramType.PlantUml, plantUmlCode: '@startuml' }),
        child('4', 'graph', { diagramType: DiagramType.Graph, graphXml: '<mxfile/>' }),
        child('5', 'api', { diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0' }),
      ),
    ])
    expect(out.map(d => [d.diagramType, d.copyable, d.source])).toEqual([
      [DiagramType.Sequence, true, 'A->B: hi'],
      [DiagramType.Mermaid, true, 'graph TD;'],
      [DiagramType.PlantUml, true, '@startuml'],
      // Copying raw DrawIO XML / a whole spec out of a byline popup is not a
      // coherent affordance — offered for text DSLs only.
      [DiagramType.Graph, false, ''],
      [DiagramType.OpenApi, false, ''],
    ])
  })

  it('keeps a diagram whose stored body is malformed instead of dropping it', () => {
    // The diagram is visibly on the page; omitting it from the list would read
    // as data loss to the user.
    const out = parsePageDiagrams([ok(child('1', 'Broken', '{not json'))])
    expect(out).toHaveLength(1)
    expect(out[0].diagramType).toBe(DiagramType.Unknown)
    expect(out[0].copyable).toBe(false)
  })

  it('does not let one errored content type suppress the others', () => {
    const out = parsePageDiagrams([
      { errors: [{ status: 403, title: 'Forbidden' }] },
      ok(child('7', 'Survivor', { diagramType: DiagramType.Sequence, code: 'A->B: x' })),
    ])
    expect(out.map(d => d.id)).toEqual(['7'])
  })

  it('falls back to a type label when the custom content has no title', () => {
    const out = parsePageDiagrams([
      ok(
        child('1', '', { diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD;' }),
        child('2', '   ', { diagramType: DiagramType.Unknown }),
      ),
    ])
    expect(out[0].title).toBe('Mermaid')
    expect(out[1].title).toBe('Diagram')
  })

  it('will not offer a copy button that would yield an empty clipboard', () => {
    const out = parsePageDiagrams([ok(child('1', 'Empty', { diagramType: DiagramType.Sequence, code: '' }))])
    expect(out[0].copyable).toBe(false)
  })

  it('de-duplicates ids seen in more than one response', () => {
    const dup = child('1', 'Same', { diagramType: DiagramType.Sequence, code: 'A->B: x' })
    expect(parsePageDiagrams([ok(dup), ok(dup)]).map(d => d.id)).toEqual(['1'])
  })

  it('tolerates empty, null and malformed responses', () => {
    expect(parsePageDiagrams([])).toEqual([])
    expect(parsePageDiagrams([null, undefined, {}, { results: null }] as any)).toEqual([])
    expect(parsePageDiagrams(null as any)).toEqual([])
  })
})

describe('summarizeDiagrams', () => {
  it('reports the empty page, which is the common case', () => {
    expect(summarizeDiagrams([])).toEqual({
      page_has_diagram: false,
      diagram_count: 0,
      macro_types: '',
    })
  })

  it('de-duplicates and sorts types so the property stays low-cardinality', () => {
    const out = summarizeDiagrams([
      { id: '1', title: 'a', diagramType: 'sequence', source: '', copyable: false },
      { id: '2', title: 'b', diagramType: 'mermaid', source: '', copyable: false },
      { id: '3', title: 'c', diagramType: 'sequence', source: '', copyable: false },
    ])
    expect(out).toEqual({ page_has_diagram: true, diagram_count: 3, macro_types: 'mermaid,sequence' })
  })
})

describe('typeLabel', () => {
  it('labels known types and degrades gracefully', () => {
    expect(typeLabel(DiagramType.PlantUml)).toBe('PlantUML')
    expect(typeLabel('something-new')).toBe('Diagram')
  })
})
