import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_PREFS, getPref, getPrefs, onPrefsChanged, setPref } from './prefs'

beforeEach(() => fakeBrowser.reset())

describe('prefs', () => {
  it('returns defaults on a fresh profile (MCP access off)', async () => {
    expect(await getPrefs()).toEqual(DEFAULT_PREFS)
    expect(await getPref('mcpAccess')).toBe('disabled')
  })

  it('round-trips values and clamps the panel width to 240–500', async () => {
    await setPref('panelCollapsed', true)
    await setPref('mcpAccess', 'enabled')
    await setPref('panelWidth', 900)
    await setPref('panelPosition', { right: 40, bottom: 60 })
    await setPref('lastPort', 47392)
    expect(await getPrefs()).toMatchObject({ panelCollapsed: true, mcpAccess: 'enabled', panelWidth: 500, panelPosition: { right: 40, bottom: 60 }, lastPort: 47392 })
  })

  it('ignores garbage written by someone else', async () => {
    await fakeBrowser.storage.local.set({ 'prPanel.mcpAccess': 'yes please', 'prPanel.panelWidth': 'wide', 'prPanel.lastPort': 99999 })
    expect(await getPrefs()).toMatchObject({ mcpAccess: 'disabled', panelWidth: 240, lastPort: null })
  })

  it('notifies listeners with only the changed keys, and stops after unsubscribe', async () => {
    const listener = vi.fn()
    const off = onPrefsChanged(listener)
    await setPref('preferencesHidden', true)
    expect(listener).toHaveBeenLastCalledWith({ preferencesHidden: true })
    off()
    await setPref('preferencesHidden', false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
