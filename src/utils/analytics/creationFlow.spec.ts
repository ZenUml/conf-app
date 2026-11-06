import { beforeEach, describe, expect, it, vi } from 'vitest'

const forgeGlobalMock = vi.hoisted(() => ({ forgeContext: undefined as any }))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: forgeGlobalMock }))

import {
  _resetCreationFlowForTesting,
  bylineCreationOrigin,
  getCreationFlowProps,
  resolveCreationOrigin,
} from './creationFlow'
import { CREATION_ORIGINS } from './catalog'

const modalCtx = (modal: Record<string, unknown>) => ({ extension: { modal } })

describe('resolveCreationOrigin', () => {
  it('defaults to page_editor when no modal carries an origin', () => {
    expect(resolveCreationOrigin(undefined)).toBe('page_editor')
    expect(resolveCreationOrigin({ extension: {} })).toBe('page_editor')
    expect(resolveCreationOrigin(modalCtx({ macroMode: 'editor', diagramType: 'graph' }))).toBe('page_editor')
  })

  it.each(CREATION_ORIGINS)('reads %s from modal.creationOrigin', (origin) => {
    expect(resolveCreationOrigin(modalCtx({ macroMode: 'editor', creationOrigin: origin }))).toBe(origin)
  })

  it('reports unknown when a value is carried but is not a known origin', () => {
    expect(resolveCreationOrigin(modalCtx({ creationOrigin: 'somewhere_else' }))).toBe('unknown')
    expect(resolveCreationOrigin(modalCtx({ creationOrigin: 42 }))).toBe('unknown')
  })

  it('reports unknown for a byline modal that predates creationOrigin', () => {
    // origin: 'byline' proves it was not the page editor, but not which host mode.
    expect(resolveCreationOrigin(modalCtx({ macroMode: 'editor', origin: 'byline' }))).toBe('unknown')
  })
})

describe('bylineCreationOrigin', () => {
  it('maps the host page mode to the byline origin', () => {
    expect(bylineCreationOrigin(false)).toBe('byline_view')
    expect(bylineCreationOrigin(true)).toBe('byline_editor')
  })
})

describe('getCreationFlowProps', () => {
  beforeEach(() => {
    _resetCreationFlowForTesting()
    forgeGlobalMock.forgeContext = undefined
  })

  it('is page_editor with a flow id when nothing is carried', () => {
    const props = getCreationFlowProps()
    expect(props.creation_origin).toBe('page_editor')
    expect(props.creation_flow_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns the same origin and flow id on every call in one iframe (start -> success -> cancel)', () => {
    forgeGlobalMock.forgeContext = modalCtx({ macroMode: 'editor', creationOrigin: 'byline_editor' })
    const start = getCreationFlowProps()
    const success = getCreationFlowProps()
    expect(start.creation_origin).toBe('byline_editor')
    expect(success).toEqual(start)
  })

  it('starts a new flow after a reset', () => {
    const first = getCreationFlowProps()
    _resetCreationFlowForTesting()
    expect(getCreationFlowProps().creation_flow_id).not.toBe(first.creation_flow_id)
  })
})
