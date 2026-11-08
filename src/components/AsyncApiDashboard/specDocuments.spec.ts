import { describe, it, expect } from 'vitest'
import { parseSpecSummary, toSpecDocument } from './specDocuments'

const OPENAPI3 = `openapi: 3.0.3
info:
  title: Pets API
  version: 1.2.0
  description: Pet store
paths:
  /pets:
    summary: ignored
    parameters: []
    get: {}
    post: {}
  /pets/{id}:
    parameters: []
    GET: {}
    delete: {}
    x-extension: {}
`

const SWAGGER2 = `swagger: "2.0"
info:
  title: Legacy API
  version: "1.0"
paths:
  /a:
    get: {}
`

const ASYNC2 = `asyncapi: 2.6.0
info:
  title: Lights
  version: 0.1.0
  description: Street lights
channels:
  light/measured: {}
  light/turn: {}
servers:
  prod: {}
`

const ASYNC3 = `asyncapi: 3.0.0
info:
  title: Lights v3
  version: 3.0.1
channels:
  a: {}
  b: {}
  c: {}
operations:
  send: {}
`

describe('parseSpecSummary', () => {
  it('parses OpenAPI 3 and counts only HTTP-method keys as operations', () => {
    expect(parseSpecSummary(OPENAPI3)).toEqual({
      format: 'openapi',
      title: 'Pets API',
      apiVersion: '1.2.0',
      description: 'Pet store',
      schemaVersion: '3.0.3',
      pathsCount: 2,
      operationsCount: 4, // get, post, GET, delete; summary/parameters/x-extension ignored
    })
  })

  it('parses Swagger 2 as openapi format', () => {
    expect(parseSpecSummary(SWAGGER2)).toMatchObject({
      format: 'openapi',
      schemaVersion: '2.0',
      pathsCount: 1,
      operationsCount: 1,
      apiVersion: '1.0',
    })
  })

  it('parses AsyncAPI 2 with channel and server counts', () => {
    expect(parseSpecSummary(ASYNC2)).toEqual({
      format: 'asyncapi',
      title: 'Lights',
      apiVersion: '0.1.0',
      description: 'Street lights',
      schemaVersion: '2.6.0',
      channelsCount: 2,
      serversCount: 1,
    })
  })

  it('parses AsyncAPI 3; absent servers stay undefined', () => {
    const s = parseSpecSummary(ASYNC3)
    expect(s.format).toBe('asyncapi')
    expect(s.schemaVersion).toBe('3.0.0')
    expect(s.channelsCount).toBe(3)
    expect(s.serversCount).toBeUndefined()
  })

  it('truncates long descriptions to 180 chars plus an ellipsis', () => {
    const s = parseSpecSummary(`asyncapi: 2.0.0\ninfo:\n  description: ${'x'.repeat(300)}\n`)
    expect(s.description).toBe('x'.repeat(180) + '…')
  })

  it('returns {} for invalid YAML, empty input and non-object documents', () => {
    expect(parseSpecSummary('foo: [unclosed')).toEqual({})
    expect(parseSpecSummary(undefined)).toEqual({})
    expect(parseSpecSummary('')).toEqual({})
    expect(parseSpecSummary('just a string')).toEqual({})
  })
})

const entry = (over: any = {}, value: any = {}): any => ({
  id: '42',
  space: { key: 'DOCS' },
  value: { diagramType: 'AsyncAPI', code: ASYNC2, ...value },
  ...over,
})

describe('toSpecDocument', () => {
  it('drops non-API diagram types and entries without a value', () => {
    expect(toSpecDocument(entry({}, { diagramType: 'sequence' }))).toBeNull()
    expect(toSpecDocument(entry({}, { diagramType: 'mermaid' }))).toBeNull()
    expect(toSpecDocument({ id: '1', space: { key: 'X' } } as any)).toBeNull()
  })

  it('accepts async* (any case), openapi and swagger', () => {
    expect(toSpecDocument(entry({}, { diagramType: 'asyncapi' }))?.format).toBe('asyncapi')
    expect(toSpecDocument(entry({}, { diagramType: 'AsyncApi' }))?.format).toBe('asyncapi')
    expect(toSpecDocument(entry({}, { diagramType: 'OpenAPI', code: OPENAPI3 }))?.format).toBe('openapi')
    expect(toSpecDocument(entry({}, { diagramType: 'swagger', code: SWAGGER2 }))?.format).toBe('openapi')
  })

  it('title precedence: parsed > entry.title > value.title > untitled', () => {
    expect(toSpecDocument(entry({ title: 'E' }, { title: 'V' }))?.displayTitle).toBe('Lights')
    const noInfo = 'asyncapi: 2.0.0\n'
    expect(toSpecDocument(entry({ title: 'E' }, { title: 'V', code: noInfo }))?.displayTitle).toBe('E')
    expect(toSpecDocument(entry({}, { title: 'V', code: noInfo }))?.displayTitle).toBe('V')
    expect(toSpecDocument(entry({}, { code: noInfo }))?.displayTitle).toBe('Untitled AsyncAPI')
    expect(
      toSpecDocument(entry({}, { diagramType: 'openapi', code: 'openapi: 3.0.0\n' }))?.displayTitle,
    ).toBe('Untitled OpenAPI')
  })

  it('maps the row fields the dashboard shows', () => {
    const doc = toSpecDocument(
      entry(
        {
          createdAt: '2026-01-02T03:04:05Z',
          version: { number: 7, createdAt: '2026-02-03T04:05:06Z' },
          pageId: 99,
          container: { title: 'My page', link: 'https://x/wiki/p' },
        },
        { status: 'trashed' },
      ),
    )!
    expect(doc).toMatchObject({
      id: '42',
      contentId: '42',
      format: 'asyncapi',
      title: 'Lights',
      description: 'Street lights',
      code: ASYNC2,
      apiVersion: '0.1.0',
      schemaVersion: '2.6.0',
      channelsCount: 2,
      serversCount: 1,
      rev: 7,
      status: 'trashed',
      createdAt: '2026-01-02T03:04:05Z',
      updatedAt: '2026-02-03T04:05:06Z',
      pageId: '99',
      pageLabel: 'My page',
      pageUrl: 'https://x/wiki/p',
    })
    expect(doc.createdLabel).toMatch(/^Created /)
    expect(doc.updatedLabel).toMatch(/^Updated /)
  })

  it('falls back to the entry status and to "Page <id>" label', () => {
    const doc = toSpecDocument(entry({ status: 'current', pageId: 5 }))!
    expect(doc.status).toBe('current')
    expect(doc.pageLabel).toBe('Page 5')
  })

  // Missing-id decision: id is entry.id, else value.id; with neither there is
  // no stable key (and no contentId to view/edit), so the row is dropped.
  it('uses value.id when entry.id is absent', () => {
    const doc = toSpecDocument(entry({ id: undefined }, { id: 'v-9' }))!
    expect(doc.id).toBe('v-9')
    expect(doc.contentId).toBe('')
  })

  it('drops a row with no id anywhere, deterministically', () => {
    expect(toSpecDocument(entry({ id: undefined }))).toBeNull()
    expect(toSpecDocument(entry({ id: '' }))).toBeNull()
  })

  it('gives the same id on repeated mapping', () => {
    const e = entry()
    expect(toSpecDocument(e)?.id).toBe(toSpecDocument(e)?.id)
  })
})
