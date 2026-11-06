import { describe, it, expect } from 'vitest'
import { createConnectMcpShownRecord } from './connectMcpShown'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 15, 9, 0, 0)

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
  }
}

describe('createConnectMcpShownRecord', () => {
  const scope = { cloudId: 'cloud-1', accountId: 'acc-1' }

  it('reports the first showing of each UTC day only', () => {
    const storage = memoryStorage()
    let now = T0
    const record = createConnectMcpShownRecord(scope, storage, () => now)
    expect(record.recordShown()).toBe(true)
    expect(record.recordShown()).toBe(false)
    now = T0 + 10 * 60 * 60 * 1000 // 19:00 UTC, same day
    expect(createConnectMcpShownRecord(scope, storage, () => now).recordShown()).toBe(false)
    now = T0 + DAY
    expect(record.recordShown()).toBe(true)
  })

  it('keeps separate records per site and account', () => {
    const storage = memoryStorage()
    expect(createConnectMcpShownRecord(scope, storage, () => T0).recordShown()).toBe(true)
    expect(createConnectMcpShownRecord({ cloudId: 'cloud-2', accountId: 'acc-1' }, storage, () => T0).recordShown()).toBe(true)
    expect(createConnectMcpShownRecord({ cloudId: 'cloud-1', accountId: 'acc-2' }, storage, () => T0).recordShown()).toBe(true)
  })

  it('emits nothing without storage', () => {
    expect(createConnectMcpShownRecord(scope, null, () => T0).recordShown()).toBe(false)
  })

  it('emits nothing when storage throws', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(createConnectMcpShownRecord(scope, throwing, () => T0).recordShown()).toBe(false)
  })
})
