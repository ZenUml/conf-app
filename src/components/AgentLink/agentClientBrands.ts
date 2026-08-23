import { siClaudecode, siCursor, siDeepseek } from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'

export interface AgentClientBrand {
  label: string
  icon: SimpleIcon
}

// Simple Icons 16.28.0 ships these CC0-licensed brand paths. Codex and the
// Pi coding agent are deliberately absent: this package has no corresponding
// marks, so the UI uses a neutral live-connection glyph for Codex and omits Pi
// from illustrative discovery rather than approximating either trademark.
export const WAITING_CLIENT_BRANDS: readonly AgentClientBrand[] = [
  { label: 'Claude Code', icon: siClaudecode },
  { label: 'Cursor', icon: siCursor },
  { label: 'DeepSeek', icon: siDeepseek },
]

const LIVE_CLIENT_BRANDS = new Map<string, AgentClientBrand>(
  WAITING_CLIENT_BRANDS.filter(({ label }) => label === 'Claude Code' || label === 'Cursor').map(
    (brand) => [brand.label, brand]
  )
)

export function getLiveClientBrand(label: string): AgentClientBrand | null {
  return LIVE_CLIENT_BRANDS.get(label) ?? null
}
