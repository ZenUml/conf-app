// src/composables/agentLink/connectInstructions.ts
//
// The user-facing connect copy shared by the Fullscreen ConnectPanel rail and
// the inline Connect MCP dialog, so the setup command and the prompts exist
// once.
//
// The MCP server URL is the Lite backend for every product except AsyncAPI
// (ADR 0011): Lite and Diagramly already call it, and Full points there too
// instead of at its own conf-full / conf-stg-full, because Full's sign-in
// already completes on the Lite backend (its OAuth redirect URI is the
// conf-lite callback) and both projects share the grant KV and D1. Lite prod
// is conf-lite, AsyncAPI prod zenapi (a conf-lite custom domain), staging and
// dev conf-stg-lite. An OAuth grant only resolves on the backend that issued
// it, so the URL must name that backend.
//
// A relay session token resolves only on the backend that minted it
// (mintAgentLinkSession() uses forgeGlobal.zenumlRemoteBaseUrl). Relay
// sessions are off (RELAY_SESSIONS_ENABLED below); turning them back on for
// Full needs the relay to mint on the same backend this URL names.
import forgeGlobal, { resolveZenumlRemoteBaseUrl } from '@/model/globals/forgeGlobal'

// The name the user's MCP client files the server under, so its tools show up
// as e.g. mcp__diagramly__read_diagram. Per product, so each app's users see
// their own product's name: Lite and Full are ZenUML, while Diagramly and
// AsyncAPI are separate brands with their own Forge apps.
export function mcpServerName(product: { isDiagramly?: boolean; isAsyncApi?: boolean } = forgeGlobal): string {
  if (product.isDiagramly) return 'diagramly'
  if (product.isAsyncApi) return 'asyncapi'
  return 'zenuml'
}

/** The product the prompt names the diagram after, matching mcpServerName(). */
function productLabel(product: { isDiagramly?: boolean; isAsyncApi?: boolean } = forgeGlobal): string {
  if (product.isDiagramly) return 'Diagramly'
  if (product.isAsyncApi) return 'AsyncAPI'
  return 'ZenUML'
}

// Standalone/dev has no Forge context and so no resolved backend; fall back
// to the production Lite host rather than render a relative URL.
const FALLBACK_BACKEND_BASE_URL = 'https://conf-lite.zenuml.com'

interface McpBackendSource {
  isLite?: boolean
  isDiagramly?: boolean
  isAsyncApi?: boolean
  zenumlRemoteBaseUrl?: string
  forgeContext?: { environmentType?: string }
}

/**
 * The backend the MCP server lives on: this app's own backend, except Full,
 * which uses the Lite backend for the same environment (ADR 0011). Falls back
 * to the app's own backend when the environment is not known yet.
 */
export function mcpBackendBaseUrl(product: McpBackendSource = forgeGlobal): string | undefined {
  const isFull = !product.isLite && !product.isDiagramly && !product.isAsyncApi
  const environmentType = product.forgeContext?.environmentType
  if (isFull && environmentType) {
    return resolveZenumlRemoteBaseUrl(environmentType, { isLite: true }) ?? product.zenumlRemoteBaseUrl
  }
  return product.zenumlRemoteBaseUrl
}

export function mcpServerUrl(backendBaseUrl: string | undefined = mcpBackendBaseUrl()): string {
  const base = (backendBaseUrl || FALLBACK_BACKEND_BASE_URL).replace(/\/+$/, '')
  return `${base}/agent-link/mcp`
}

export function mcpAddCommand(backendBaseUrl?: string): string {
  return `claude mcp add --transport http ${mcpServerName()} ${mcpServerUrl(backendBaseUrl)}`
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
  const lines = [`Use the ${mcpServerName()} MCP to review my ${productLabel()} diagram ${name}.`]
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

// The Confluence Home page card's prompt. That surface has no diagram, so
// instead of naming one the agent lists the viewer's recent diagrams on this
// site (list_diagrams without a pageId covers the whole site) and asks which
// one to work on. Like buildHeadlessPrompt, nothing changes without a go-ahead.
export function buildHomepagePrompt(target: { cloudId?: string } = {}): string {
  const lines = [`Use the ${mcpServerName()} MCP to work with my ${productLabel()} diagrams in Confluence.`]
  if (target.cloudId) lines.push(`cloudId: ${target.cloudId}`)
  else lines.push('Find the site with list_sites.')
  lines.push(
    '',
    '1. List my most recently modified diagrams with list_diagrams.',
    '2. Summarize what each one shows.',
    '3. Ask me which one to work on, and wait for my go-ahead before changing it with update_diagram.',
  )
  return lines.join('\n')
}

export function buildConnectPrompt(token: string | null): string {
  return [
    `Connect to my ${productLabel()} diagram via the ${mcpServerName()} MCP.`,
    `session: ${token ?? ''}`,
    '# reads this page · edits this diagram · 10 min idle / 60 min max',
  ].join('\n')
}
