import { beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_LINK_CLIENT_MEMORY_KEY,
  AGENT_LINK_CLIENT_MEMORY_MAX_AGE_MS,
  normalizeAgentLinkClientLabel,
  readAgentLinkClientMemory,
  rememberAgentLinkClient,
} from './clientMemory'

describe('Agent Link remembered client cue', () => {
  beforeEach(() => window.localStorage.clear())

  it.each(['Codex', 'Claude Code', 'Cursor'] as const)('retains the recognized safe label %s', (label) => {
    rememberAgentLinkClient(label, 1_000)
    expect(readAgentLinkClientMemory(2_000)).toEqual({ label, connectedAt: 1_000 })
    expect(JSON.parse(localStorage.getItem(AGENT_LINK_CLIENT_MEMORY_KEY)!)).toEqual({
      label,
      connectedAt: 1_000,
    })
  })

  it('normalizes unknown or untrusted labels to a generic cue', () => {
    expect(normalizeAgentLinkClientLabel('Unknown Client with secret metadata')).toBe('an AI agent')
    rememberAgentLinkClient('Unknown Client with secret metadata', 1_000)
    expect(readAgentLinkClientMemory(2_000)?.label).toBe('an AI agent')
    expect(localStorage.getItem(AGENT_LINK_CLIENT_MEMORY_KEY)).not.toContain('Unknown Client')
  })

  it('ignores missing, malformed, future, and stale records', () => {
    expect(readAgentLinkClientMemory(10_000)).toBeNull()
    localStorage.setItem(AGENT_LINK_CLIENT_MEMORY_KEY, 'not json')
    expect(readAgentLinkClientMemory(10_000)).toBeNull()
    rememberAgentLinkClient('Codex', 20_000)
    expect(readAgentLinkClientMemory(10_000)).toBeNull()
    rememberAgentLinkClient('Codex', 1_000)
    expect(readAgentLinkClientMemory(1_000 + AGENT_LINK_CLIENT_MEMORY_MAX_AGE_MS + 1)).toBeNull()
  })

  it('a later successful connection replaces only the label and recency', () => {
    rememberAgentLinkClient('Codex', 1_000)
    rememberAgentLinkClient('Claude Code', 2_000)
    expect(readAgentLinkClientMemory(3_000)).toEqual({ label: 'Claude Code', connectedAt: 2_000 })
    expect(Object.keys(JSON.parse(localStorage.getItem(AGENT_LINK_CLIENT_MEMORY_KEY)!)).sort()).toEqual([
      'connectedAt',
      'label',
    ])
  })
})
