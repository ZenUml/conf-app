import { siClaudecode, siCursor } from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'
import codexIconUrl from '@lobehub/icons-static-svg/icons/codex-color.svg'

export type LiveAgentClientLabel = 'Codex' | 'Claude Code' | 'Cursor' | 'AI assistant'

export interface LiveAgentClientBrand {
  label: Exclude<LiveAgentClientLabel, 'AI assistant'>
  icon?: SimpleIcon
  assetUrl?: string
}

// Only a small fixed label set can select a brand asset. Raw MCP clientInfo is
// never rendered or used as an asset path; unrecognized values stay neutral.
const LIVE_CLIENT_BRANDS = new Map<string, LiveAgentClientBrand>([
  ['Codex', { label: 'Codex', assetUrl: codexIconUrl }],
  ['Claude Code', { label: 'Claude Code', icon: siClaudecode }],
  ['Cursor', { label: 'Cursor', icon: siCursor }],
])

export function normalizeLiveAgentClientLabel(value: unknown): LiveAgentClientLabel {
  if (typeof value !== 'string') return 'AI assistant'
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-')
  if (['codex', 'codex-mcp', 'codex-mcp-client'].includes(normalized)) return 'Codex'
  if (['claude-code', 'claude-code-mcp', 'claude-code-mcp-client'].includes(normalized)) return 'Claude Code'
  if (['cursor', 'cursor-client', 'cursor-mcp-client'].includes(normalized)) return 'Cursor'
  return 'AI assistant'
}

export function getLiveClientBrand(label: LiveAgentClientLabel): LiveAgentClientBrand | null {
  return LIVE_CLIENT_BRANDS.get(label) ?? null
}
