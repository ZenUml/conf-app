import type { AgentKind } from '@zenuml/pr-panel-shared'

export function detectAgent(env: NodeJS.ProcessEnv): { kind: AgentKind; sessionId?: string } {
  // A live Claude Code MCP server process has CLAUDECODE and CLAUDE_CODE_ENTRYPOINT (2026-10-23).
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) {
    const sessionId = env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID
    return { kind: 'claude_code', ...(sessionId ? { sessionId } : {}) }
  }
  const codex = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID
  if (codex) return { kind: 'codex', sessionId: codex }
  return { kind: 'other' }
}
