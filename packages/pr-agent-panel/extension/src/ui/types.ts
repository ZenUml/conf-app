import type { PanelPosition } from '../state/prefs'

export type PanelConnection = 'off' | 'inactive' | 'active'

/** One line in the panel's Messages section. */
export interface PanelMessageView {
  id: string
  role: 'agent' | 'progress' | 'user'
  text: string
  /** User messages only: `sending` until the Hub answers, then `queued` or `delivered`. */
  status?: 'sending' | 'queued' | 'delivered'
  /** `messageQueued.waitingForAgent`: no agent turn will pick it up soon. */
  waitingForAgent?: boolean
}

/** The prefs the panel renders from (a subset of `Prefs`). */
export interface PanelPrefsView {
  panelCollapsed: boolean
  preferencesHidden: boolean
  mcpAccess: 'enabled' | 'disabled'
  panelWidth: number
  panelPosition: PanelPosition | null
}
