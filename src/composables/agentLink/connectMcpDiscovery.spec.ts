import { describe, it, expect } from 'vitest'
import { createConnectMcpDiscovery, DISCOVERY_WINDOW_DAYS } from './connectMcpDiscovery'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 15, 9, 0, 0)

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
  }
}

describe('createConnectMcpDiscovery', () => {
  const scope = { cloudId: 'cloud-1', accountId: 'acc-1' }

  it('shows the button at rest for a viewer who has never seen it', () => {
    const discovery = createConnectMcpDiscovery(scope, memoryStorage(), () => T0)
    expect(discovery.reveal()).toBe('always')
  })

  it('keeps it at rest inside the discovery window, then hands it to hover', () => {
    const storage = memoryStorage()
    let now = T0
    const discovery = createConnectMcpDiscovery(scope, storage, () => now)
    discovery.recordShown()
    now = T0 + (DISCOVERY_WINDOW_DAYS - 1) * DAY
    expect(discovery.reveal()).toBe('always')
    now = T0 + DISCOVERY_WINDOW_DAYS * DAY
    expect(discovery.reveal()).toBe('hover')
  })

  it('hands it to hover once the dialog has been opened', () => {
    const discovery = createConnectMcpDiscovery(scope, memoryStorage(), () => T0)
    discovery.recordShown()
    discovery.recordOpened()
    expect(discovery.reveal()).toBe('hover')
  })

  it('reports the first showing of each UTC day only', () => {
    const storage = memoryStorage()
    let now = T0
    const discovery = createConnectMcpDiscovery(scope, storage, () => now)
    expect(discovery.recordShown()).toBe(true)
    expect(discovery.recordShown()).toBe(false)
    now = T0 + 10 * 60 * 60 * 1000 // 19:00 UTC, same day
    expect(createConnectMcpDiscovery(scope, storage, () => now).recordShown()).toBe(false)
    now = T0 + DAY
    expect(discovery.recordShown()).toBe(true)
  })

  it('keeps the first-shown time when later days are recorded', () => {
    const storage = memoryStorage()
    let now = T0
    const discovery = createConnectMcpDiscovery(scope, storage, () => now)
    discovery.recordShown()
    now = T0 + 3 * DAY
    discovery.recordShown()
    const [raw] = [...storage.data.values()]
    expect(JSON.parse(raw).firstShownAt).toBe(T0)
  })

  it('keeps separate state per site and account', () => {
    const storage = memoryStorage()
    createConnectMcpDiscovery(scope, storage, () => T0).recordOpened()
    expect(createConnectMcpDiscovery(scope, storage, () => T0).reveal()).toBe('hover')
    expect(createConnectMcpDiscovery({ cloudId: 'cloud-2', accountId: 'acc-1' }, storage, () => T0).reveal()).toBe('always')
  })

  it('falls back to hover and emits nothing without storage', () => {
    const discovery = createConnectMcpDiscovery(scope, null, () => T0)
    expect(discovery.reveal()).toBe('hover')
    expect(discovery.recordShown()).toBe(false)
  })

  it('falls back to hover and emits nothing when storage throws', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    const discovery = createConnectMcpDiscovery(scope, throwing, () => T0)
    expect(discovery.reveal()).toBe('hover')
    expect(discovery.recordShown()).toBe(false)
  })

  it('treats a corrupt record as a fresh viewer', () => {
    const storage = memoryStorage()
    storage.setItem('zenuml.connectMcpDiscovery:cloud-1:acc-1', '{not json')
    const discovery = createConnectMcpDiscovery(scope, storage, () => T0)
    expect(discovery.reveal()).toBe('always')
    expect(discovery.recordShown()).toBe(true)
  })
})
