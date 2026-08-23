// Stable MCP initialization contract for Agent Link. Keep protocol revisions
// explicit: the hosted endpoint and installed MCP clients can move on separate
// deployment schedules, so silently returning one hard-coded revision creates
// a misleading partial connection when the two sides drift.

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export type SupportedMcpProtocolVersion = (typeof SUPPORTED_MCP_PROTOCOL_VERSIONS)[number];

export const LATEST_MCP_PROTOCOL_VERSION: SupportedMcpProtocolVersion =
  SUPPORTED_MCP_PROTOCOL_VERSIONS[0];

// These are the only optional MCP server capabilities Agent Link implements.
// The object is deliberately small and stable; tool-level capabilities remain
// discoverable through tools/list rather than being duplicated here.
export const AGENT_LINK_MCP_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
} as const;

export interface McpInitializeParams {
  protocolVersion?: unknown;
  capabilities?: unknown;
  clientInfo?: unknown;
}

export type SafeAgentClientLabel = 'Codex' | 'Claude Code' | 'Cursor' | 'an AI agent';

/** Reduce untrusted initialize.clientInfo to one display-only product label. */
export function normalizeAgentClientLabel(params: unknown): SafeAgentClientLabel {
  const input = isRecord(params) ? params : {};
  const clientInfo = isRecord(input.clientInfo) ? input.clientInfo : {};
  const raw = `${typeof clientInfo.name === 'string' ? clientInfo.name : ''} ${
    typeof clientInfo.title === 'string' ? clientInfo.title : ''
  }`.toLowerCase();
  if (/\bcodex\b/.test(raw)) return 'Codex';
  if (/claude[\s_-]*code/.test(raw)) return 'Claude Code';
  if (/\bcursor\b/.test(raw)) return 'Cursor';
  return 'an AI agent';
}

export type McpCompatibilityResult =
  | {
      ok: true;
      protocolVersion: SupportedMcpProtocolVersion;
      capabilities: typeof AGENT_LINK_MCP_CAPABILITIES;
    }
  | {
      ok: false;
      code: 'protocol_version_required' | 'client_capabilities_required' | 'protocol_version_mismatch';
      message: string;
      requested?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSupportedMcpProtocolVersion(
  value: string,
): value is SupportedMcpProtocolVersion {
  return SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(value as SupportedMcpProtocolVersion);
}

/**
 * Validate the client half of MCP initialization and select the exact shared
 * revision. MCP clients send their newest supported revision; accepting only
 * revisions in this explicit set prevents a newer/older client from falling
 * through into a connection whose methods only partly work.
 */
export function negotiateMcpCompatibility(params: unknown): McpCompatibilityResult {
  const input = isRecord(params) ? (params as McpInitializeParams) : {};
  if (typeof input.protocolVersion !== 'string' || input.protocolVersion.trim() === '') {
    return {
      ok: false,
      code: 'protocol_version_required',
      message: 'Agent Link requires the MCP client to declare its protocol version during initialization.',
    };
  }

  if (!isRecord(input.capabilities)) {
    return {
      ok: false,
      code: 'client_capabilities_required',
      message: 'Agent Link requires the MCP client capabilities object during initialization.',
      requested: input.protocolVersion,
    };
  }

  if (!isSupportedMcpProtocolVersion(input.protocolVersion)) {
    return {
      ok: false,
      code: 'protocol_version_mismatch',
      message:
        'Agent Link protocol version mismatch. Update your AI agent or its Agent Link MCP configuration, then start a new agent session before reconnecting.',
      requested: input.protocolVersion,
    };
  }

  return {
    ok: true,
    protocolVersion: input.protocolVersion,
    capabilities: AGENT_LINK_MCP_CAPABILITIES,
  };
}
