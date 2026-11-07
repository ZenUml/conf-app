import { describe, expect, it } from 'vitest'
import { detectAgent } from './agent-detect'

describe('detectAgent', () => {
  // Env names captured from a live Claude Code MCP server process on 2026-10-23:
  // CLAUDECODE and CLAUDE_CODE_ENTRYPOINT are set; CLAUDE_CODE is not.
  it('recognises Claude Code from CLAUDECODE', () => {
    expect(detectAgent({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }).kind).toBe('claude_code')
  })

  it('recognises Claude Code from CLAUDE_CODE_ENTRYPOINT alone', () => {
    expect(detectAgent({ CLAUDE_CODE_ENTRYPOINT: 'cli' }).kind).toBe('claude_code')
  })

  it('recognises Codex from CODEX_THREAD_ID', () => {
    expect(detectAgent({ CODEX_THREAD_ID: 't-1' })).toEqual({ kind: 'codex', sessionId: 't-1' })
  })

  it('falls back to other', () => {
    expect(detectAgent({})).toEqual({ kind: 'other' })
  })
})
