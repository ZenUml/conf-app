import { describe, it, expect } from 'vitest'
import { bylineNounFor, capitalize } from './bylineNoun'

describe('bylineNounFor', () => {
  it('calls them API docs in the AsyncAPI app, whose byline is titled API Docs', () => {
    expect(bylineNounFor('asyncapi')).toMatchObject({
      one: 'API doc', many: 'API docs', aOne: 'an API doc', title: 'API Docs', make: 'Write',
    })
  })

  it('keeps "diagram" in every other variant', () => {
    for (const v of ['lite', 'full', 'diagramly', undefined]) {
      expect(bylineNounFor(v)).toMatchObject({ one: 'diagram', aOne: 'a diagram', title: 'Diagrams', make: 'Draw' })
    }
  })

  it('capitalises without touching the rest', () => {
    expect(capitalize('an API doc')).toBe('An API doc')
    expect(capitalize('diagrams')).toBe('Diagrams')
  })
})
