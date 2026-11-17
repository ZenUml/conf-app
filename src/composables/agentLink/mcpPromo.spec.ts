import { describe, expect, it } from 'vitest'
import { createMcpPromoState, MAX_SESSIONS } from './mcpPromo'
import { createConnectMcpShownRecord } from './connectMcpShown'

function memory() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

const scope = { cloudId: 'cloud-1', accountId: 'acct-1' }

describe('createMcpPromoState', () => {
  it('shows by default and counts one impression per browser session', () => {
    const local = memory()
    const session = memory()
    const s = createMcpPromoState(scope, local, session, () => 'sess-a')
    expect(s.canShow()).toBe(true)
    s.recordShown()
    s.recordShown()
    expect(JSON.parse(local.map.get('zenuml.mcpPromo:cloud-1:acct-1')!).sessions).toEqual(['sess-a'])
  })

  it(`stops after ${MAX_SESSIONS} sessions but keeps showing within the last one`, () => {
    const local = memory()
    for (let i = 0; i < MAX_SESSIONS; i++) {
      const s = createMcpPromoState(scope, local, memory(), () => `sess-${i}`)
      expect(s.canShow()).toBe(true)
      s.recordShown()
    }
    const lastSession = memory()
    lastSession.setItem('zenuml.mcpPromo.session', `sess-${MAX_SESSIONS - 1}`)
    expect(createMcpPromoState(scope, local, lastSession).canShow()).toBe(true)
    expect(createMcpPromoState(scope, local, memory(), () => 'sess-new').canShow()).toBe(false)
  })

  it('never shows again after a dismissal, on any surface of the same viewer', () => {
    const local = memory()
    createMcpPromoState(scope, local, memory()).dismiss()
    expect(createMcpPromoState(scope, local, memory()).canShow()).toBe(false)
    expect(createMcpPromoState({ ...scope, accountId: 'acct-2' }, local, memory()).canShow()).toBe(true)
  })

  it('never shows again once the viewer engaged with the dialog', () => {
    const local = memory()
    createMcpPromoState(scope, local, memory()).markEngaged()
    expect(createMcpPromoState(scope, local, memory()).canShow()).toBe(false)
  })

  it('fails closed when storage is unavailable or throws', () => {
    expect(createMcpPromoState(scope, null, memory()).canShow()).toBe(false)
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(createMcpPromoState(scope, throwing, memory()).canShow()).toBe(false)
  })

  it('treats a corrupt record as fresh', () => {
    const local = memory()
    local.setItem('zenuml.mcpPromo:cloud-1:acct-1', '{not json')
    expect(createMcpPromoState(scope, local, memory()).canShow()).toBe(true)
  })
})

describe('createConnectMcpShownRecord placement keys', () => {
  it('dedupes each promo placement separately from the header button', () => {
    const storage = memory()
    const clock = () => Date.parse('2026-11-06T00:00:00Z')
    expect(createConnectMcpShownRecord(scope, storage, clock).recordShown()).toBe(true)
    expect(createConnectMcpShownRecord({ ...scope, placement: 'fullscreen_card' }, storage, clock).recordShown()).toBe(true)
    expect(createConnectMcpShownRecord({ ...scope, placement: 'fullscreen_card' }, storage, clock).recordShown()).toBe(false)
    expect(storage.map.has('zenuml.connectMcpShown:cloud-1:acct-1')).toBe(true)
  })
})
