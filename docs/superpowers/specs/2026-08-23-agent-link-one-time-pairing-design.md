# Agent Link One-Time Pairing Design

**Date:** 2026-08-23

## Goal

Install the hosted Agent Link MCP endpoint once, then connect each open Confluence Macro with a short-lived one-time code. V1 has no Agent Link OAuth user, explicit Project, local daemon, or long-lived Atlassian credential.

## Product boundary

- The coding agent's current repository is the local code context; Agent Link does not model it as a Project.
- The open Forge Macro is the privileged Confluence actor and remains open for the session.
- Confluence Custom Content remains the diagram body system of record.
- Closing the page, explicitly disconnecting, or reaching the session deadline invalidates the pairing.
- Background updates while the page is closed are out of scope.

## Current behavior being replaced

Today the Macro mints a short-lived token and asks the user to run `claude mcp add` with that token in an `Authorization: Bearer ...` header. A fresh Macro session therefore leaves a dead credential in MCP config and requires another configuration update.

The token, relay, bound `{cloudId, pageId, contentId}`, TTL, content lock, and Forge bridge remain useful. This change moves the token from MCP transport configuration into a one-time `connect` tool call.

## Public flow

### One-time setup

Claude Code:

```bash
claude mcp add --transport http conf-agent https://conf-stg-lite.zenuml.com/agent-link/mcp
```

Codex:

```bash
codex mcp add conf-agent --url https://conf-stg-lite.zenuml.com/agent-link/mcp
```

These are the staging experiment commands. The product UI derives the same
credential-free endpoint from its current deployment environment.

### Per-Macro pairing

1. The user clicks **Connect Agent**.
2. The Macro mints the existing high-entropy short-lived token and presents it as a one-time linking code.
3. The user copies a prompt such as `Using conf-agent, call connect with code <code>.`
4. The client calls `connect({code})` on its existing MCP transport session.
5. The server atomically claims the code for that MCP session and records an MCP-session-to-Agent-Link-token binding.
6. Later tools resolve the binding and use the existing target Durable Object and Macro relay.
7. Reusing the code from another MCP session is rejected.

## MCP transport contract

- `initialize` is allowed without an Agent Link code.
- The initialize response issues a random `Mcp-Session-Id` response header.
- CORS exposes `Mcp-Session-Id` and accepts `Mcp-Session-Id` plus `MCP-Protocol-Version` request headers.
- The client must return `Mcp-Session-Id` on later requests, as required by Streamable HTTP MCP.
- `tools/list` remains available before pairing and advertises `connect` plus the normal tools, so clients do not need a server-pushed tool-list refresh after pairing.
- `resources/list` and `resources/read` remain public because they contain static DSL guidance only.
- `connect` is the only unpaired tool call. Every diagram/page/status tool returns a structured `not_paired` error until `connect` succeeds.
- A second `connect` on the same MCP session may replace its active target. The old target claim is released before the new target is committed.
- `DELETE /agent-link/mcp` terminates the MCP transport session and releases its target claim when clients send the standard termination request. Target TTL remains the crash-recovery backstop.

## Durable Object state

The existing `AGENT_LINK` namespace continues to host one `AgentLinkSession` class with three address flavors:

- Agent Link target: `idFromName(code)` — existing Macro session and relay state.
- Content lock: `idFromName(content:<cloudId>:<contentId>)` — existing one-live-session guard.
- MCP binding: `idFromName(mcp:<mcpSessionId>)` — new short-lived mapping to the claimed target code.

The target instance stores the claiming MCP session ID. The binding instance stores the target code. Both are checked on every paired tool call; target expiry or disconnect makes a stale mapping unusable.

Pairing is intentionally one code to one MCP session. Multiple Claude/Codex windows receive distinct MCP session IDs and cannot silently share a code.

## Error contract

`connect` returns MCP tool errors with stable reasons:

- `invalid_code` — no live target exists for the code.
- `expired_code` — the target session deadline passed.
- `code_already_used` — another MCP session claimed it.
- `mcp_session_missing` — the client did not preserve the server-issued MCP session ID.
- `target_unavailable` — the Macro is not currently connected.

Normal tools called before pairing return `not_paired`. A target that disconnects after pairing keeps the existing `macro_disconnected` retriable behavior while its resume window is live.

No error includes the code, target IDs, diagram body, or client credential.

## Analytics contract

Existing events continue to cover the lifecycle:

- `agent_link_connect_clicked` — user requests a Macro session.
- `agent_link_session_created` — linking code is minted.
- `agent_link_session_expired` with `had_agent_connected=false` — no successful pairing before timeout.
- `agent_link_disconnected` — terminal teardown.

New events are registered before implementation:

- `agent_link_connection_instruction_copied`
  - Trigger: user copies either the permanent setup command or the per-session pairing prompt.
  - Properties: `feature_area=agent_link`, `surface=fullscreen`, `macro_type`, `pairing_method=linking_code`, `instruction_kind=setup_command|pairing_prompt`.
- `agent_link_pairing_completed`
  - Trigger: the relay confirms that `connect(code)` claimed this Macro session.
  - Properties: `feature_area=agent_link`, `surface=fullscreen`, `macro_type`, `pairing_method=linking_code`, `client_name`, `time_to_connect_ms`.

Failed/abandoned pairing is measured by `session_created` minus `pairing_completed`, segmented by `session_expired(had_agent_connected=false)`. This avoids inventing a client-side failure event the Macro cannot reliably observe for an invalid unknown code.

## Security

- The linking code is a capability secret, not a Project ID.
- It retains the current high entropy, idle TTL, absolute cap, context binding, content lock, and write-to-bound-content restriction.
- A successful claim is one-time and cannot be taken over by another MCP session.
- The code is present only in the transient user prompt and `connect` request, never in permanent MCP config.
- Logs and analytics never record the code.
- Unpaired clients cannot read page or diagram data.

## Verification

### Unit and integration tests

1. `initialize` without Authorization succeeds and returns `Mcp-Session-Id`.
2. `tools/list` without a pairing advertises `connect`.
3. Diagram tools before pairing return `not_paired`.
4. `connect` with a live code binds the MCP session.
5. The same MCP session can call `get_status` and `read_diagram` without resending the code.
6. Another MCP session cannot consume the same code.
7. Expired and invalid codes return stable errors.
8. Disconnect/expiry makes an existing binding unusable.
9. The Bearer auth requirement and its tests are replaced; there is no compatibility lane because Agent Link is unreleased.

### Real-client experiment

Run the full flow independently with the locally installed Claude Code and Codex versions:

1. Install the fixed endpoint once.
2. Start a Macro session and call `connect(code)`.
3. Call `get_status`, `read_diagram`, and a reversible `update_diagram`.
4. Confirm concurrent client sessions do not cross targets.
5. Restart the client: the endpoint remains installed, but a fresh code is required.
6. Confirm the Macro UI with screenshots; raw HTTP alone does not satisfy the UI spot check.

## Rollout

This is an unreleased Agent Link feature, so V1 does not preserve the per-session Bearer setup UX. Deployment order remains companion Worker first, then Pages/frontend, because the Pages MCP handler depends on the new Durable Object endpoints.
