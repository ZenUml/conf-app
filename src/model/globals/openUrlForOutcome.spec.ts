import { afterEach, describe, expect, it, vi } from 'vitest'
const open = vi.fn()
vi.mock('@forge/bridge', () => ({ router: { open } }))
import forgeGlobal, { openUrlForOutcome } from './forgeGlobal'

describe('openUrlForOutcome', () => {
  afterEach(() => { vi.clearAllMocks(); forgeGlobal.isForge = undefined })

  it('reports opened when router.open resolves', async () => {
    forgeGlobal.isForge = true
    open.mockResolvedValue(true)
    expect(await openUrlForOutcome('https://conf-lite.zenuml.com/x')).toBe('opened')
  })

  it('reports declined when the user cancels the external-page dialog', async () => {
    forgeGlobal.isForge = true
    open.mockRejectedValue(new Error('cancelled'))
    expect(await openUrlForOutcome('https://buy.stripe.com/x')).toBe('declined')
  })

  it('reports error for any other rejection, and never throws', async () => {
    forgeGlobal.isForge = true
    open.mockRejectedValue(new Error('bridge gone'))
    expect(await openUrlForOutcome('https://x.example')).toBe('error')
  })

  it('outside Forge, reports error when the browser blocks the new window', async () => {
    forgeGlobal.isForge = false
    const spy = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(await openUrlForOutcome('https://x.example')).toBe('error')
    spy.mockRestore()
  })
})
