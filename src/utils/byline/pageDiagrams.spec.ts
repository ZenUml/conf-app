import { describe, it, expect } from 'vitest'
import { parsePageDiagrams, summarizeDiagrams, summarizeListing, sortPageDiagrams, typeLabel, toMacroType, toModalDiagramType } from './pageDiagrams'
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
    expect(out[0].title).toBe('Flowchart')
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
      { id: '1', title: 'a', diagramType: 'sequence', source: '', copyable: false, createdAt: '' },
      { id: '2', title: 'b', diagramType: 'mermaid', source: '', copyable: false, createdAt: '' },
      { id: '3', title: 'c', diagramType: 'sequence', source: '', copyable: false, createdAt: '' },
    ])
    expect(out).toEqual({ page_has_diagram: true, diagram_count: 3, macro_types: 'mermaid,sequence' })
  })

  it('emits the catalog vocabulary, not the stored one', () => {
    // The stored `diagramType` for the spec types is `OpenAPI`/`AsyncAPI` and
    // the fallback is `unknown` — none of which are values `macro_type` ever
    // carries. Emitting them raw meant byline_opened.macro_types could not be
    // joined against macro_type on any other byline event without per-query
    // string munging. Sequence/mermaid happen to coincide, which is why the
    // test above stayed green through the bug.
    const out = summarizeDiagrams([
      { id: '1', title: 'a', diagramType: DiagramType.OpenApi, source: '', copyable: false, createdAt: '' },
      { id: '2', title: 'b', diagramType: DiagramType.AsyncApi, source: '', copyable: false, createdAt: '' },
      { id: '3', title: 'c', diagramType: DiagramType.Unknown, source: '', copyable: false, createdAt: '' },
    ])
    expect(out.macro_types).toBe('asyncapi,none,openapi')
  })
})

describe('summarizeListing', () => {
  const okWith = (n: number) => ({ results: new Array(n).fill({}) })
  const errored = { errors: [{ title: 'Current user not permitted' }] }

  it('does not call a fully-readable page a failure', () => {
    expect(summarizeListing([okWith(0), okWith(2)])).toEqual({
      failed_type_count: 0,
      listing_failed: false,
    })
  })

  it('separates "no diagrams" from "could not find out"', () => {
    // The whole point: forgeRequest resolves error bodies rather than throwing,
    // so a 403 reaches parsePageDiagrams as a response with no `results` and is
    // indistinguishable from an empty page. Both cases below produce
    // `diagram_count: 0`; only one of them means the page has no diagrams.
    expect(summarizeListing([okWith(0), okWith(0)]).listing_failed).toBe(false)
    expect(summarizeListing([errored, errored]).listing_failed).toBe(true)
  })

  it('counts a partial failure without declaring the whole listing unknown', () => {
    // One content type 403ing still leaves a usable answer for the other, which
    // is why parsePageDiagrams skips error responses rather than aborting.
    expect(summarizeListing([errored, okWith(3)])).toEqual({
      failed_type_count: 1,
      listing_failed: false,
    })
  })

  it('treats an empty array as total failure, not as nothing probed', () => {
    // [] is listPageDiagramContents's outer-catch return value.
    expect(summarizeListing([]).listing_failed).toBe(true)
    expect(summarizeListing(null as any).listing_failed).toBe(true)
  })

  it('treats a response with no results array as errored', () => {
    expect(summarizeListing([null, undefined, {}] as any)).toEqual({
      failed_type_count: 3,
      listing_failed: true,
    })
  })
})

describe('toMacroType', () => {
  it('lowercases the spec types so they do not split the Mixpanel bucket', () => {
    // Stored bodies say `OpenAPI`/`AsyncAPI`; every other surface reports
    // lowercase, and casting instead of mapping would create a second bucket
    // for the same macro type.
    expect(toMacroType(DiagramType.OpenApi)).toBe('openapi')
    expect(toMacroType(DiagramType.AsyncApi)).toBe('asyncapi')
  })

  it('passes through the types that already match the catalog', () => {
    expect(toMacroType(DiagramType.Sequence)).toBe('sequence')
    expect(toMacroType(DiagramType.Mermaid)).toBe('mermaid')
    expect(toMacroType(DiagramType.PlantUml)).toBe('plantuml')
    expect(toMacroType(DiagramType.Graph)).toBe('graph')
    expect(toMacroType(DiagramType.Embed)).toBe('embed')
  })

  it('maps anything unrecognised to a value the catalog already defines', () => {
    expect(toMacroType(DiagramType.Unknown)).toBe('none')
    expect(toMacroType('something-new')).toBe('none')
  })
})

describe('toModalDiagramType', () => {
  it('routes the whole text-DSL family as sequence', () => {
    // isSequenceFamilyEntry only recognises 'sequence'/'mermaid' as modal
    // types, so announcing 'plantuml' would fall through to the swagger viewer.
    expect(toModalDiagramType(DiagramType.Sequence)).toBe('sequence')
    expect(toModalDiagramType(DiagramType.PlantUml)).toBe('sequence')
    expect(toModalDiagramType(DiagramType.Mermaid)).toBe('mermaid')
  })

  it('routes the moduleKey-discriminated types by their lowercase name', () => {
    expect(toModalDiagramType(DiagramType.Graph)).toBe('graph')
    expect(toModalDiagramType(DiagramType.Embed)).toBe('embed')
    expect(toModalDiagramType(DiagramType.OpenApi)).toBe('openapi')
    expect(toModalDiagramType(DiagramType.AsyncApi)).toBe('asyncapi')
  })

  // Regression: the routing table was indexed exactly while its siblings folded
  // case. Real stored bodies say `openapi` / `asyncapi`, so BOTH missed and fell
  // back to 'sequence' — the byline opened a swagger/AsyncAPI document in the
  // sequence viewer. These are the spellings that actually arrive from
  // parsePageDiagrams, not the enum members the tests above use.
  it('routes the spellings real stored bodies use, not just the enum members', () => {
    expect(toModalDiagramType('openapi')).toBe('openapi')
    expect(toModalDiagramType('asyncapi')).toBe('asyncapi')
    expect(toModalDiagramType('AsyncAPI')).toBe('asyncapi')
    expect(toModalDiagramType('graph')).toBe('graph')
  })

  it('falls back to the family that can render an unknown body', () => {
    expect(toModalDiagramType(DiagramType.Unknown)).toBe('sequence')
    expect(toModalDiagramType('something-new')).toBe('sequence')
  })
})

describe('sortPageDiagrams', () => {
  const d = (id: string, createdAt = ''): any => ({ id, createdAt, title: id, diagramType: 'sequence', source: '', copyable: false })

  it('lists diagrams the way the page reads', () => {
    // The API returns them grouped by custom-content type — all sequence-family
    // entries, then all graphs — which has no relation to what the reader sees.
    const out = sortPageDiagrams([d('c'), d('a'), d('b')], ['b', 'a', 'c'])
    expect(out.map(x => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('puts diagrams no macro references last, oldest first', () => {
    const out = sortPageDiagrams(
      [d('stray-new', '2025-03-01T00:00:00.000Z'), d('placed'), d('stray-old', '2025-01-01T00:00:00.000Z')],
      ['placed'],
    )
    expect(out.map(x => x.id)).toEqual(['placed', 'stray-old', 'stray-new'])
  })

  it('falls back to creation order when the page could not be scanned', () => {
    // Not "leave it as the API returned it": that order is type-grouped, so an
    // unscannable page would list graphs after sequences for no visible reason.
    const out = sortPageDiagrams([d('b', '2025-02-01T00:00:00.000Z'), d('a', '2025-01-01T00:00:00.000Z')])
    expect(out.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('places a diagram at its first macro, not its last', () => {
    // One custom content can be referenced by several macros (a copied macro).
    // The entry belongs where the reader first meets it.
    const out = sortPageDiagrams([d('x'), d('y')], ['y', 'x', 'y'])
    expect(out.map(x => x.id)).toEqual(['y', 'x'])
  })

  it('sorts an unknown creation time last rather than first', () => {
    const out = sortPageDiagrams([d('no-date'), d('dated', '2025-01-01T00:00:00.000Z')])
    expect(out.map(x => x.id)).toEqual(['dated', 'no-date'])
  })

  it('does not mutate the caller\'s array', () => {
    const input = [d('b'), d('a')]
    sortPageDiagrams(input, ['a', 'b'])
    expect(input.map(x => x.id)).toEqual(['b', 'a'])
  })
})

describe('typeLabel', () => {
  it('labels known types and degrades gracefully', () => {
    expect(typeLabel(DiagramType.Sequence)).toBe('Sequence')
    expect(typeLabel(DiagramType.Graph)).toBe('Graph')
    expect(typeLabel('something-new')).toBe('Diagram')
  })

  it('gives both flowchart dialects the one name the picker offers', () => {
    // The picker offers a single "Flowchart" choice covering both, so labelling
    // the result MERMAID / PLANTUML showed the user a type they never picked
    // and gave them no way to tell it was the thing they asked for.
    expect(typeLabel(DiagramType.Mermaid)).toBe('Flowchart')
    expect(typeLabel(DiagramType.PlantUml)).toBe('Flowchart')
  })
})

describe('stored diagramType casing (lite-dev, 2026-08-21)', () => {
  // Real custom-content bodies on lite-dev store `openapi` in lower case, while
  // DiagramType.OpenApi is 'OpenAPI'. Every table here is keyed on the enum, so
  // an exact-match lookup misses and the row falls back to 'Diagram' / 'none'.
  // Observed on custom content 67600411 "Demo · OpenAPI":
  //   body.raw.value -> {"diagramType":"openapi", ...}
  // sequence / mermaid / graph store values that already match the enum.
  it('labels an OpenAPI diagram whose stored type is lower case', () => {
    expect(typeLabel('openapi')).toBe('OpenAPI')
  })

  it('reports the macro type for a lower-case stored OpenAPI type', () => {
    expect(toMacroType('openapi')).toBe('openapi')
  })

  it('labels an AsyncAPI diagram whose stored type is lower case', () => {
    expect(typeLabel('asyncapi')).toBe('AsyncAPI')
  })

  it('still returns the fallbacks for a genuinely unknown type', () => {
    expect(typeLabel('kroki')).toBe('Diagram')
    expect(toMacroType('kroki')).toBe('none')
  })
})
