// src/composables/agentLink/connectInstructions.ts
//
// The user-facing connect copy shared by the Fullscreen ConnectPanel rail and
// the inline Connect MCP dialog, so the setup command and the session prompt
// exist once.
//
// The MCP server URL follows the backend that mints the session
// (forgeGlobal.zenumlRemoteBaseUrl — the same origin mintAgentLinkSession()
// and the relay channel use), because a session token only resolves on the
// backend that issued it: Lite prod mints on conf-lite, Full on conf-full,
// staging and dev environments on conf-stg-lite. A fixed host would hand
// every other environment a server that cannot find its session.
import forgeGlobal from '@/model/globals/forgeGlobal'

export const MCP_SERVER_NAME = 'zenuml'

// Standalone/dev has no Forge context and so no resolved backend; fall back
// to the production Lite host rather than render a relative URL.
const FALLBACK_BACKEND_BASE_URL = 'https://conf-lite.zenuml.com'

export function mcpServerUrl(backendBaseUrl: string | undefined = forgeGlobal.zenumlRemoteBaseUrl): string {
  const base = (backendBaseUrl || FALLBACK_BACKEND_BASE_URL).replace(/\/+$/, '')
  return `${base}/agent-link/mcp`
}

export function mcpAddCommand(backendBaseUrl?: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpServerUrl(backendBaseUrl)}`
}

export function buildConnectPrompt(token: string | null): string {
  return [
    `Connect to my ZenUML diagram via the ${MCP_SERVER_NAME} MCP.`,
    `session: ${token ?? ''}`,
    '# reads this page · edits this diagram · 10 min idle / 60 min max',
  ].join('\n')
}

// startConnect() shows a local `pending-<ts>` placeholder until the relay
// mint resolves; it is not a token an agent can use.
export function isUsableSessionToken(token: string | null): token is string {
  return !!token && !token.startsWith('pending-')
}
