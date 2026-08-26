import { describe, expect, it } from 'vitest'
import {
  buildDrawioEditorSrc,
  GRAPH_EDITOR_MODE_CONFIG_KEY,
  normalizeGraphEditorMode,
} from '@/utils/graph/graphEditorMode'

describe('normalizeGraphEditorMode', () => {
  it('defaults a new document to diagram', () => {
    expect(normalizeGraphEditorMode(undefined)).toBe('diagram')
    expect(normalizeGraphEditorMode(null)).toBe('diagram')
    expect(normalizeGraphEditorMode('')).toBe('diagram')
  })

  it('restores a persisted board value', () => {
    expect(normalizeGraphEditorMode('board')).toBe('board')
  })

  it('falls back to diagram for unknown values', () => {
    expect(normalizeGraphEditorMode('sketch')).toBe('diagram')
    expect(normalizeGraphEditorMode('Board')).toBe('diagram')
    expect(normalizeGraphEditorMode(1)).toBe('diagram')
  })
})

describe('buildDrawioEditorSrc', () => {
  it('keeps the embed chrome visible in diagram mode and omits board-only params', () => {
    const src = buildDrawioEditorSrc('diagram')
    expect(src.startsWith('./drawio/index.html?')).toBe(true)
    expect(src).toContain('embed=1')
    expect(src).toContain('proto=json')
    expect(src).toContain('noSaveBtn=1')
    expect(src).toContain('saveAndExit=1')
    expect(src).toContain('publishClose=1')
    expect(src).toContain('noExitBtn=1')
    expect(src).toContain('libraries=1')
    // Keep DrawIO's external-data capability locked down without triggering
    // v31's standalone-app chrome path, which hides the Publish container.
    expect(src).toContain('lockdown=1')
    expect(src).not.toContain('offline=1')
    expect(src).not.toContain('sketch=1')
    expect(src).not.toContain('ui=sketch')
    expect(src).not.toContain('format=0')
  })

  it('includes sketch=1 and sketch chrome for board mode', () => {
    const src = buildDrawioEditorSrc('board')
    expect(src).toContain('sketch=1')
    expect(src).toContain('ui=sketch')
    expect(src).toContain('format=0')
    expect(src).toContain('embed=1')
    expect(src).toContain('publishClose=1')
    expect(src).toContain('lockdown=1')
    expect(src).not.toContain('offline=1')
  })

  it('treats unknown mode as diagram URL params', () => {
    const src = buildDrawioEditorSrc('whiteboard' as never)
    expect(src).not.toContain('sketch=1')
    expect(src).not.toContain('ui=sketch')
    expect(src).not.toContain('format=0')
  })
})

describe('macro config key', () => {
  it('persists mode under a single graphEditorMode config key', () => {
    expect(GRAPH_EDITOR_MODE_CONFIG_KEY).toBe('graphEditorMode')
  })
})
