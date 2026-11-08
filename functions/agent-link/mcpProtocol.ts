// Shared transport helpers. Public rendering must not import the authenticated
// Confluence server just to negotiate a protocol version or bound telemetry.
import { UI_EXTENSION_ID } from './oauth/mcpApps';
import { withDeadline } from '../../src/lib/withTimeout.js';

const ANALYTICS_TIMEOUT_MS = 2_000;

/** Bound a fire-and-forget analytics call so it cannot outlive the request it describes. */
export function withTimeout(work: Promise<unknown>): Promise<void> {
  return withDeadline<void, void>(work.then(() => undefined), ANALYTICS_TIMEOUT_MS, undefined)
    .catch(() => undefined);
}

/**
 * MCP protocol revisions, newest first. '2026-01-26' is the MCP Apps extension
 * spec date, not a protocol revision; answering with it breaks real clients.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

/** Did the client advertise the MCP Apps extension in its initialize params? */
export function clientDeclaresUi(params: unknown): boolean {
  const ext = (params as { capabilities?: { extensions?: Record<string, unknown> } } | undefined)
    ?.capabilities?.extensions;
  return !!ext && Object.prototype.hasOwnProperty.call(ext, UI_EXTENSION_ID);
}
