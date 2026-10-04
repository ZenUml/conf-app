// src/composables/agentLink/connectInstructions.ts
//
// The user-facing connect copy shared by the Fullscreen ConnectPanel rail and
// the inline Connect MCP dialog, so the setup command and the session prompt
// exist once. Relay host per design §14.3: zenapi.zenuml.com, to avoid a new
// egress host / re-consent.

export const MCP_SERVER_NAME = 'conf-agent'

export const MCP_SERVER_URL = 'https://zenapi.zenuml.com/agent-link/mcp'

export const MCP_ADD_COMMAND = `claude mcp add --transport http ${MCP_SERVER_NAME} ${MCP_SERVER_URL}`

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
