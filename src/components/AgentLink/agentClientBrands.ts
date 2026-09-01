import { siClaudecode, siCursor, siDeepseek } from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'
import codexIconUrl from '@lobehub/icons-static-svg/icons/codex-color.svg'

export interface AgentClientBrand {
  label: string
  icon: SimpleIcon
}

export interface LiveAgentClientBrand {
  label: 'Codex' | 'Claude Code' | 'Cursor'
  icon?: SimpleIcon
  assetUrl?: string
}

// Simple Icons 16.28.0 ships these CC0-licensed brand paths. The waiting
// carousel remains intentionally illustrative and omits products without a
// suitable mark in that set rather than approximating a trademark.
export const WAITING_CLIENT_BRANDS: readonly AgentClientBrand[] = [
  { label: 'Claude Code', icon: siClaudecode },
  { label: 'Cursor', icon: siCursor },
  { label: 'DeepSeek', icon: siDeepseek },
]

// The live header can additionally use the pinned MIT-licensed Lobe Icons
// Codex asset. Only these normalized labels ever select a brand; untrusted
// clientInfo never becomes an asset path or raw display string.
const LIVE_CLIENT_BRANDS = new Map<string, LiveAgentClientBrand>([
  ['Codex', { label: 'Codex', assetUrl: codexIconUrl }],
  ['Claude Code', { label: 'Claude Code', icon: siClaudecode }],
  ['Cursor', { label: 'Cursor', icon: siCursor }],
])

export function getLiveClientBrand(label: string): LiveAgentClientBrand | null {
  return LIVE_CLIENT_BRANDS.get(label) ?? null
}
