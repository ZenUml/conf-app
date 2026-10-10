// src/composables/agentLink/connectInstructions.ts
//
// The user-facing connect copy shared by the Fullscreen ConnectPanel rail and
// the inline Connect MCP dialog, so the setup command and the prompts exist
// once.
//
// The MCP server URL follows this macro's backend
// (forgeGlobal.zenumlRemoteBaseUrl — the same origin mintAgentLinkSession()
// and the relay channel use): Lite prod is conf-lite, Full conf-full,
// staging and dev environments conf-stg-lite. Both credentials only resolve
// there — a relay session token on the backend that minted it, and an OAuth
// grant on the backend that issued it.
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

// The first release offers the headless MCP only: the agent signs in with
// Atlassian OAuth the first time the server is used, then reads and edits
// diagrams through Confluence directly. The relay session (a macro-minted
// `CL-` token, live re-render, the Fullscreen rail and live badge) stays in
// the code base but is not offered. A plain `claude mcp add` sends no session
// token, so the server answers in headless mode anyway (mcp.ts, MODE
// SELECTION) — offering the relay would need the token in the client config.
export const RELAY_SESSIONS_ENABLED = false

export interface HeadlessDiagramTarget {
  title?: string
  cloudId?: string
  pageId?: string
  contentId?: string
}

// A review request: the agent reads the diagram (and its page, for context),
// says what it shows and what is unclear, inconsistent or missing, and
// proposes improvements. It changes nothing until the user agrees, because
// every update_diagram publishes a page version. The diagram is named by the
// ids the headless tools take (read_diagram / update_diagram
// { cloudId, contentId }), so no lookup is needed. Without a contentId (a
// macro never saved) the agent finds it on the page instead.
export function buildHeadlessPrompt(target: HeadlessDiagramTarget): string {
  const name = target.title?.trim() ? `"${target.title.trim()}"` : 'on this page'
  const lines = [`Use the ${MCP_SERVER_NAME} MCP to review my ZenUML diagram ${name}.`]
  if (target.cloudId) lines.push(`cloudId: ${target.cloudId}`)
  else lines.push('Find the site with list_sites.')
  if (target.pageId) lines.push(`pageId: ${target.pageId}`)
  if (target.contentId) lines.push(`contentId: ${target.contentId}`)
  const read = target.contentId
    ? 'Read it with read_diagram'
    : 'Find it with list_diagrams for this page, then read it with read_diagram'
  lines.push(
    '',
    `1. ${read}${target.pageId ? ', and the page with read_page for context' : ''}.`,
    '2. Summarize what the diagram shows.',
    '3. Point out anything unclear, inconsistent or missing.',
    '4. Suggest improvements, then wait for my go-ahead before changing it with update_diagram.',
  )
  return lines.join('\n')
}

export function buildConnectPrompt(token: string | null): string {
  return [
    `Connect to my ZenUML diagram via the ${MCP_SERVER_NAME} MCP.`,
    `session: ${token ?? ''}`,
    '# reads this page · edits this diagram · 10 min idle / 60 min max',
  ].join('\n')
}
