import { describe, expect, it, vi } from 'vitest'
import {
  AI_CHAT_SUGGESTIONS,
  buildDiffLines,
  createCodePreview,
  createPrototypePreview,
  formatVersionTime,
} from './aiChatPrototype'

describe('AI Chat shared model', () => {
  it('provides stable quick suggestions for both editor frameworks', () => {
    expect(AI_CHAT_SUGGESTIONS.map((suggestion) => suggestion.id)).toEqual([
      'add-error-path',
      'simplify-flow',
      'highlight-steps',
    ])
  })

  it('builds line-level additions and removals', () => {
    expect(buildDiffLines('A\nB\n', 'A\nC\n')).toEqual([
      { type: 'context', code: 'A' },
      { type: 'remove', code: 'B' },
      { type: 'add', code: 'C' },
    ])
  })

  it('collapses large unchanged regions while retaining change context', () => {
    const previous = Array.from({ length: 100 }, (_, index) => `line ${index}`)
    const updated = [...previous]
    updated[50] = 'line 50 updated'

    const diff = buildDiffLines(previous.join('\n'), updated.join('\n'))

    expect(diff[0]).toEqual({ type: 'context', code: '...' })
    expect(diff.at(-1)).toEqual({ type: 'context', code: '...' })
    expect(diff).toContainEqual({ type: 'remove', code: 'line 50' })
    expect(diff).toContainEqual({ type: 'add', code: 'line 50 updated' })
    expect(diff.length).toBeLessThan(20)
  })

  it('creates a real code preview with version-ready metadata', () => {
    expect(createCodePreview('OpenAPI', 'syntax_repair', '400:', '"400":')).toMatchObject({
      title: 'Syntax fixed',
      kind: 'syntax_repair',
      updatedCode: '"400":',
      diffLocation: 'OpenAPI diagram',
      diffLines: [
        { type: 'remove', code: '400:' },
        { type: 'add', code: '"400":' },
      ],
    })
  })

  it('keeps prototype previews isolated as deterministic Storybook data', () => {
    expect(createPrototypePreview('OpenAPI', 'request', false)).toMatchObject({
      title: 'Changes applied',
      kind: 'request',
      diffLocation: 'openapi.yaml · responses',
    })
  })

  it('falls back to the current time for an invalid persisted timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T09:05:00.000Z'))

    expect(formatVersionTime('not-a-date')).toMatch(/^\d{2}:\d{2}$/)

    vi.useRealTimers()
  })
})
