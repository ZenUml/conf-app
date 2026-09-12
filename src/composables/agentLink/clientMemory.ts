export type AgentLinkClientLabel = 'Codex' | 'Claude Code' | 'Cursor' | 'an AI agent'

export interface AgentLinkClientMemory {
  label: AgentLinkClientLabel
  connectedAt: number
}

export const AGENT_LINK_CLIENT_MEMORY_KEY = 'agent-link:last-client:v1'
export const AGENT_LINK_CLIENT_MEMORY_EVENT = 'agent-link:last-client-changed'
export const AGENT_LINK_CLIENT_MEMORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function normalizeAgentLinkClientLabel(value: unknown): AgentLinkClientLabel {
  return value === 'Codex' || value === 'Claude Code' || value === 'Cursor'
    ? value
    : 'an AI agent'
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Persist only a display label and successful-connect time. */
export function rememberAgentLinkClient(
  value: unknown,
  connectedAt = Date.now(),
  storage: Storage | null = browserStorage(),
): AgentLinkClientMemory | null {
  if (!storage || !Number.isFinite(connectedAt)) return null
  const memory = { label: normalizeAgentLinkClientLabel(value), connectedAt }
  try {
    storage.setItem(AGENT_LINK_CLIENT_MEMORY_KEY, JSON.stringify(memory))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AGENT_LINK_CLIENT_MEMORY_EVENT))
    }
    return memory
  } catch {
    return null
  }
}

export function readAgentLinkClientMemory(
  now = Date.now(),
  storage: Storage | null = browserStorage(),
): AgentLinkClientMemory | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(AGENT_LINK_CLIENT_MEMORY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.connectedAt !== 'number' || !Number.isFinite(parsed.connectedAt)) return null
    if (parsed.connectedAt > now || now - parsed.connectedAt > AGENT_LINK_CLIENT_MEMORY_MAX_AGE_MS) {
      return null
    }
    return {
      label: normalizeAgentLinkClientLabel(parsed.label),
      connectedAt: parsed.connectedAt,
    }
  } catch {
    return null
  }
}
