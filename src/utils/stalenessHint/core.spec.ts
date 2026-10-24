import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import {
  isInlineEditorRender,
  readDismissMarker,
  writeDismissMarker,
  isDismissalActive,
  DISMISS_SILENCE_MS,
  DRIFT_THRESHOLD,
} from './core'

const NOW = Date.parse('2026-07-18T00:00:00Z')

describe('isInlineEditorRender (spike Q1 signature)', () => {
  it('true only for macro + isEditing + no modal', () => {
    expect(isInlineEditorRender({ extension: { type: 'macro', isEditing: true } })).toBe(true)
    expect(isInlineEditorRender({ extension: { type: 'macro', isEditing: false } })).toBe(false)
    expect(isInlineEditorRender({ extension: { type: 'macro', isEditing: true, modal: { macroMode: 'editor' } } })).toBe(false)
    expect(isInlineEditorRender({ extension: { type: 'other', isEditing: true } })).toBe(false)
    expect(isInlineEditorRender({})).toBe(false)
    expect(isInlineEditorRender(undefined)).toBe(false)
  })
})

describe('dismiss marker', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips per ccId and domain', () => {
    expect(readDismissMarker('cc-1')).toBeNull()
    writeDismissMarker('cc-1')
    const m = readDismissMarker('cc-1')
    expect(m).not.toBeNull()
    expect(Date.parse(m!.dismissedAt)).not.toBeNaN()
    expect(readDismissMarker('cc-2')).toBeNull()
  })

  it('isDismissalActive: fresh yes, expired no, malformed no', () => {
    expect(isDismissalActive(null, NOW)).toBe(false)
    expect(isDismissalActive({ dismissedAt: new Date(NOW - 1000).toISOString() }, NOW)).toBe(true)
    expect(isDismissalActive({ dismissedAt: new Date(NOW - DISMISS_SILENCE_MS - 1).toISOString() }, NOW)).toBe(false)
    expect(isDismissalActive({ dismissedAt: 'garbage' }, NOW)).toBe(false)
  })

  it('constants match the spec', () => {
    expect(DISMISS_SILENCE_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(DRIFT_THRESHOLD).toBe(5)
  })
})
