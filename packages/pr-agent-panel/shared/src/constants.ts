/**
 * Wire-level constants shared by the extension (browser), the Hub (Node) and
 * the agent plugin's hook script (Node). Nothing here may touch Node APIs:
 * runtime-dir resolution lives in the Hub.
 *
 * The connection shape copies TemPad Dev (MIT, Baidu EFE team): the extension's
 * service worker probes a short list of loopback ports with an HTTP GET, then
 * opens a WebSocket with a fixed subprotocol; the Hub accepts only extension
 * Origins. See THIRD_PARTY_NOTICES.md at the package root.
 */

/** Bump when a frame shape changes incompatibly. Hub and extension refuse mismatches. */
export const PROTOCOL_VERSION = 1 as const

/** Sec-WebSocket-Protocol value; the Hub rejects handshakes that name a different one. */
export const BRIDGE_SUBPROTOCOL = 'zenuml-pr-panel'

/**
 * Loopback ports the Hub tries in order and the extension probes in order.
 * The extension remembers the last successful port and probes it first.
 */
export const PORT_CANDIDATES = [47391, 47392, 47393, 47394] as const

/** GET http://127.0.0.1:{port}/ answers this JSON so a probe can tell our Hub from a stranger. */
export const HUB_PROBE_SERVICE = 'zenuml-pr-panel-hub'

export const MAX_PAYLOAD_BYTES = 1024 * 1024

export const PORT_PROBE_TIMEOUT_MS = 500
export const HUB_HANDSHAKE_TIMEOUT_MS = 1000
export const RECONNECT_DELAY_MS = 3000
/** A ping every 20 s keeps the MV3 service worker alive while connected (Chrome ≥116). */
export const KEEPALIVE_INTERVAL_MS = 20_000

/** `optional_host_permissions` entry the extension requests before its first probe. */
export const LOCAL_HOST_ORIGIN = 'http://127.0.0.1/*'

/** Name of the Hub's MCP server; tools surface in Claude Code as `mcp__pr-panel__<tool>`. */
export const MCP_SERVER_NAME = 'pr-panel'

/** Directory name under the OS temp dir holding the Hub's socket, lock and store. */
export const RUNTIME_DIR_NAME = 'zenuml-pr-panel'
export const HUB_SOCKET_NAME = 'hub.sock'
export const HUB_LOCK_NAME = 'hub.lock'
export const WINDOWS_PIPE_PATH = '\\\\.\\pipe\\zenuml-pr-panel'

/** JSON-RPC methods on the Unix socket (agent plugin ↔ Hub). */
export const HOOK_METHOD = 'prpanel/client-hook'
export const CLIENT_EVENT_METHOD = 'notifications/prpanel/client-event'

/** Upper bound for `wait_for_panel_messages`; below Claude Code's MCP tool timeout. */
export const WAIT_FOR_MESSAGES_MAX_MS = 25_000

export const MAX_FINDINGS_PER_REVIEW = 100
export const MAX_TAGS_PER_REVIEW = 3
export const MAX_TAG_LENGTH = 24
export const MAX_HEADLINE_LENGTH = 120
export const MAX_SUMMARY_LENGTH = 2000
export const MAX_MESSAGE_LENGTH = 4000
