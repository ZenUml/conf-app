import { afterEach, describe, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { PanelPort } from './port'

afterEach(() => {
  vi.restoreAllMocks()
  delete (browser.runtime as { lastError?: unknown }).lastError
})

function fakePort() {
  let onDisconnect: () => void = () => {}
  return {
    port: {
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: (cb: () => void) => (onDisconnect = cb) },
      disconnect: vi.fn(),
    },
    disconnect: () => onDisconnect(),
  }
}

describe('PanelPort disconnect', () => {
  it('reads runtime.lastError, so a port closed by the back/forward cache is not reported as unchecked', () => {
    const fake = fakePort()
    const lastError = vi.fn(() => ({ message: 'The page keeping the extension port is moved into back/forward cache' }))
    Object.defineProperty(browser.runtime, 'lastError', { get: lastError, configurable: true })
    const port = new PanelPort({ connect: () => fake.port as never })
    port.connect()
    fake.disconnect()
    expect(lastError).toHaveBeenCalled()
    port.disconnect()
  })
})
