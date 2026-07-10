// src/composables/agentLink/relayUrl.ts
//
// Resolves the Live Agent Link relay's host from conf-app's EXISTING backend
// config, rather than hardcoding a per-environment hostname. `zenumlRemoteBaseUrl`
// (src/model/globals/forgeGlobal.ts) is the same base URL every other backend
// call in this app already uses (src/apis/aiGenerateTitle.ts calls
// `fetch(`${forgeGlobal.zenumlRemoteBaseUrl}/ai-generate-title`, ...)`), and
// it already resolves per PRODUCT_TYPE (lite/full) x environment
// (development/staging/production) via REMOTE_BASE_URL_MAP — so staging vs
// prod (and lite vs full) fall out for free instead of being duplicated here.
// The host is on `https://*.zenuml.com`, already allowlisted in
// manifest.yml's `permissions.external.fetch.client` — so both the plain
// `fetch()` below and the `wss://` upgrade in relayClient.ts are same-host,
// no-re-consent egress (design §3 decision, §14 item 3).

import forgeGlobal from '@/model/globals/forgeGlobal'

export interface AgentLinkBoundContext {
  cloudId: string
  pageId: string
  contentId: string
}

export interface MintSessionResponse {
  token: string
  channelUrl: string
  expiresInSec: number
}

export interface MintSessionError extends Error {
  status?: number
  error?: string
}

// http(s):// -> ws(s):// — same host/path, just the upgrade-eligible scheme
// (design §4.7 tier 1: WSS direct to the relay on an allowlisted host).
export function toWebSocketBaseUrl(httpBaseUrl: string): string {
  return httpBaseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
}

// Builds the macro's `peer=macro` channel URL (relay wire protocol per
// functions/agent-link/channel.ts + AgentLinkSession.ts on the relay
// worktree): `wss://<host>/agent-link/channel?token=&peer=macro&cloudId=&pageId=&contentId=`.
// cloudId/pageId/contentId are required on the FIRST channel connection for a
// token (the DO bootstraps its bound context from them) — sent on every
// (re)connect here since resending them is harmless and this client can't
// tell whether a given attempt is the session's first.
export function agentLinkWsUrl(
  token: string,
  ctx: AgentLinkBoundContext,
  backendBaseUrl: string = forgeGlobal.zenumlRemoteBaseUrl
): string {
  const params = new URLSearchParams({
    token,
    peer: 'macro',
    cloudId: ctx.cloudId,
    pageId: ctx.pageId,
    contentId: ctx.contentId,
  })
  return `${toWebSocketBaseUrl(backendBaseUrl)}/agent-link/channel?${params.toString()}`
}

// POST /agent-link/session (design §4.3 step 2) — mints the real, short-lived
// single-use token that replaces useAgentLinkSession's `pending-<ts>`
// placeholder. Plain `fetch`, not invokeRemote/requestConfluence: the backend
// host is already an allowlisted CLIENT-side fetch target (see file header),
// so this doesn't need the Forge remote proxy tier.
export async function mintAgentLinkSession(
  ctx: AgentLinkBoundContext,
  backendBaseUrl: string = forgeGlobal.zenumlRemoteBaseUrl
): Promise<MintSessionResponse> {
  const response = await fetch(`${backendBaseUrl}/agent-link/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ctx),
  })
  if (!response.ok) {
    let errorCode: string | undefined
    try {
      const body = await response.json()
      if (body && typeof body.error === 'string') errorCode = body.error
    } catch {
      // Non-JSON error bodies still carry status below.
    }
    const error = new Error(
      `agent-link session mint failed: HTTP ${response.status}${errorCode ? ` ${errorCode}` : ''}`
    ) as MintSessionError
    error.status = response.status
    error.error = errorCode
    throw error
  }
  return response.json()
}
