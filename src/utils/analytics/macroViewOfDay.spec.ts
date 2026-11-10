import { describe, it, expect } from 'vitest'
import { classifyMacroView, MAX_KEYS_PER_DAY } from './macroViewOfDay'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const NOV_6 = Date.parse('2026-11-06T10:00:00Z')
const NOV_7 = Date.parse('2026-11-07T00:00:01Z')
const scope = { clientDomain: 'example', macroKey: 'cc-1', surface: 'viewer' }

describe('classifyMacroView', () => {
  it('reports the first render of a macro today as first, then repeat', () => {
    const storage = memoryStorage()
    expect(classifyMacroView(scope, storage, () => NOV_6)).toBe('first')
    expect(classifyMacroView(scope, storage, () => NOV_6)).toBe('repeat')
  })

  it('starts over on the next UTC day', () => {
    const storage = memoryStorage()
    classifyMacroView(scope, storage, () => NOV_6)
    expect(classifyMacroView(scope, storage, () => NOV_7)).toBe('first')
  })

  it('keeps macros, surfaces and sites apart', () => {
    const storage = memoryStorage()
    classifyMacroView(scope, storage, () => NOV_6)
    expect(classifyMacroView({ ...scope, macroKey: 'cc-2' }, storage, () => NOV_6)).toBe('first')
    expect(classifyMacroView({ ...scope, surface: 'editor' }, storage, () => NOV_6)).toBe('first')
    expect(classifyMacroView({ ...scope, clientDomain: 'other' }, storage, () => NOV_6)).toBe('first')
  })

  it('returns null, so the event is sent, when it cannot remember', () => {
    expect(classifyMacroView(scope, null, () => NOV_6)).toBeNull()
    expect(classifyMacroView({ ...scope, macroKey: null }, memoryStorage(), () => NOV_6)).toBeNull()
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(classifyMacroView(scope, throwing, () => NOV_6)).toBeNull()
  })

  it('treats a corrupt record as a fresh day', () => {
    const storage = memoryStorage()
    storage.setItem('zenuml.macroViewedToday:example', '{not json')
    expect(classifyMacroView(scope, storage, () => NOV_6)).toBe('first')
  })

  it('stops remembering past the cap, so later macros stay first', () => {
    const storage = memoryStorage()
    for (let i = 0; i < MAX_KEYS_PER_DAY; i++) {
      classifyMacroView({ ...scope, macroKey: `cc-${i}` }, storage, () => NOV_6)
    }
    const extra = { ...scope, macroKey: 'cc-extra' }
    expect(classifyMacroView(extra, storage, () => NOV_6)).toBe('first')
    expect(classifyMacroView(extra, storage, () => NOV_6)).toBe('first')
    expect(classifyMacroView({ ...scope, macroKey: 'cc-0' }, storage, () => NOV_6)).toBe('repeat')
  })
})
