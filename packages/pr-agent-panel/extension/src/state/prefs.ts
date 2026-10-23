import { browser } from 'wxt/browser'

export type McpAccess = 'enabled' | 'disabled'

/** Panel offset from the viewport's bottom-right corner, in CSS px. */
export interface PanelPosition {
  right: number
  bottom: number
}

export interface Prefs {
  panelCollapsed: boolean
  /** Default false: the expanded reference (Figma 184:5446) shows Preferences open. */
  preferencesHidden: boolean
  /** Default disabled: the extension never probes loopback ports until the user opts in. */
  mcpAccess: McpAccess
  lastPort: number | null
  panelWidth: number
  panelPosition: PanelPosition | null
}

export const PANEL_DEFAULT_WIDTH = 240
export const PANEL_MIN_WIDTH = 240
export const PANEL_MAX_WIDTH = 500

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  panelCollapsed: false,
  preferencesHidden: false,
  mcpAccess: 'disabled',
  lastPort: null,
  panelWidth: PANEL_DEFAULT_WIDTH,
  panelPosition: null,
})

const PREFIX = 'prPanel.'
const KEYS = Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]
const storageKey = (key: keyof Prefs) => `${PREFIX}${key}`

function coerce<K extends keyof Prefs>(key: K, value: unknown): Prefs[K] {
  const fallback = DEFAULT_PREFS[key]
  switch (key) {
    case 'panelCollapsed':
    case 'preferencesHidden':
      return (typeof value === 'boolean' ? value : fallback) as Prefs[K]
    case 'mcpAccess':
      return (value === 'enabled' || value === 'disabled' ? value : fallback) as Prefs[K]
    case 'lastPort':
      return (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : null) as Prefs[K]
    case 'panelWidth':
      return (typeof value === 'number' && Number.isFinite(value)
        ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(value)))
        : fallback) as Prefs[K]
    case 'panelPosition': {
      const v = value as Partial<PanelPosition> | null | undefined
      return (v && typeof v.right === 'number' && typeof v.bottom === 'number' && Number.isFinite(v.right) && Number.isFinite(v.bottom)
        ? { right: v.right, bottom: v.bottom }
        : null) as Prefs[K]
    }
    default:
      return fallback
  }
}

export async function getPrefs(): Promise<Prefs> {
  const raw = await browser.storage.local.get(KEYS.map(storageKey))
  const prefs = { ...DEFAULT_PREFS } as Prefs
  for (const key of KEYS) (prefs as unknown as Record<string, unknown>)[key] = coerce(key, raw[storageKey(key)])
  return prefs
}

export async function getPref<K extends keyof Prefs>(key: K): Promise<Prefs[K]> {
  const raw = await browser.storage.local.get(storageKey(key))
  return coerce(key, raw[storageKey(key)])
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
  await browser.storage.local.set({ [storageKey(key)]: coerce(key, value) })
}

export type PrefsChange = Partial<Prefs>

/** Calls `listener` with the changed prefs (coerced) whenever another context writes them. Returns an unsubscribe function. */
export function onPrefsChanged(listener: (change: PrefsChange) => void): () => void {
  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return
    const change: Record<string, unknown> = {}
    let any = false
    for (const key of KEYS) {
      const c = changes[storageKey(key)]
      if (c) {
        change[key] = coerce(key, c.newValue)
        any = true
      }
    }
    if (any) listener(change as PrefsChange)
  }
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}
