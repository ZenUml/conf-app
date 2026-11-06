import { describe, expect, it } from 'vitest'
import { bylineTileMacroTypes } from './pickerTypes'

describe('bylineTileMacroTypes', () => {
  it('offers Lite every type, AsyncAPI included (ADR-0005 Option A)', () => {
    expect(bylineTileMacroTypes('lite')).toEqual(['mermaid', 'sequence', 'graph', 'openapi', 'asyncapi'])
  })

  // Full strips zenuml-asyncapi-macro; an AsyncAPI tile there would open the
  // OpenAPI editor and save a swagger document.
  it('offers Full everything but AsyncAPI', () => {
    expect(bylineTileMacroTypes('full')).toEqual(['mermaid', 'sequence', 'graph', 'openapi'])
  })

  it('offers the AsyncAPI app only the two API-spec types it ships', () => {
    expect(bylineTileMacroTypes('asyncapi')).toEqual(['openapi', 'asyncapi'])
  })
})
