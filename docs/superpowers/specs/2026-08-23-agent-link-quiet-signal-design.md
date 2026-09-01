# Agent Link Quiet Signal Design

## Purpose

Make the fullscreen Agent Link rail feel like a calm companion to the diagram, not a succession of technical empty states. The user's task is always the same: let an AI agent work with the current diagram. The interface should only demand attention when the user must act.

## Visual Thesis

The connection is a small, persistent signal in the rail header. It is not a separate status page.

- **Disconnected:** neutral dot and `Connect to an AI agent` header.
- **Connecting / automatic recovery:** 8px amber dot. A translucent wave expands from the dot and fades every 1.35 seconds. The dot itself does not scale and there is no static outer ring.
- **Connected:** the actual normalized client identity at left, plus a small green dot and `Connected` at right. Recognized Codex, Claude Code, and Cursor clients use only licensed installed marks. Unknown clients use a neutral glyph and `AI assistant`; raw client identity is never shown.

The wave is disabled under `prefers-reduced-motion`; the amber dot remains visible. Color is never the sole status signal because the adjacent header text changes with it.

## Layout and State Behavior

### Header

The header is the durable visual anchor across all lifecycle states. It contains only the actual client identity, a short capability/activity subline, and the connection signal. It does not repeat the visible diagram title.

### Initial pairing

The panel body expands into one connection note:

1. A short, user-oriented title: `Connect`.
2. One sentence: copy the note into the AI assistant currently in use.
3. A contained diagram-to-agent connection note, with the pairing prompt inside it.
4. One primary `Copy prompt` button.
5. `Need help?` as progressive disclosure only.

The connection note is readable context, not a second button. Hovering it must not translate or noticeably move it. At most it may receive a subtle border or shadow change. The primary button is semantic `<button>` UI with a pointer cursor, visible focus state, and modest hover feedback.

### Automatic recovery

Automatic recovery must not replace, clear, or reflow the panel body. The user continues to see the same timeline, session TTL, and explicit session actions. Only the header status changes to amber `Connecting` and plays the small wave animation. Transport-only `Connection paused`/`Connection restored` records do not appear in the user timeline. There are no recovery instructions, recovery countdowns, help links, or copy actions.

### Connected activity timeline

After pairing, the rail body is a short session timeline rather than a transport log.

- Remove the redundant `Linked to [diagram]` row; the diagram is already visible beside the rail.
- Show at most the five newest user-facing activity items, newest first.
- An in-progress diagram edit is the first timeline item and uses the same row geometry as settled entries. It may change icon/background treatment but must not add a separate banner or cause a layout jump.
- Read, search, list, edit-success, and actionable edit-failure summaries remain user-facing. WebSocket pause/resume diagnostics stay in telemetry and internal state only.

### Other lifecycle states

Expired pairing, explicit disconnect, and protocol incompatibility retain the existing lifecycle-specific single-action model. They use the same header anchor but only introduce a new panel body when user action is required. User-facing copy avoids `reconnect` jargon; only the MCP incompatibility action explicitly says `Copy prompt to upgrade your MCP`.

## Component Boundaries

- `AgentStatusHeader` owns semantic state label, safe agent identity, signal color, and reduced-motion-safe pulse.
- `ConnectPanel` owns lifecycle-specific body content, the bounded activity timeline, and the one primary action for actionable states.
- `useAgentLinkSession` and the existing same-origin session handoff carry only the normalized display-level client label to the fullscreen rail. They never carry raw `clientInfo`, versions, tokens beyond the existing session token field, endpoints, or internal IDs for identity display.
- The connection note is a non-interactive presentation component; the copy control remains the only primary action.
- Existing protocol, session, telemetry, pairing, and remembered-agent behavior do not change.

## Token Direction

- Ink: `#122033`
- Mist surface: `#F8FAFC`
- Primary action: `#1769D1`
- Recovery amber: `#D79A1C`
- Connected green: `#2F9560`

Use the existing product typography and spacing system. The design requires an 8px base grid, one primary visual action, and no large status illustration.

## Accessibility and Verification

- The signal state has accompanying text and a screen-reader status.
- Motion respects `prefers-reduced-motion`.
- `Copy prompt` remains keyboard reachable with a visible focus indicator and correct button semantics.
- Test that automatic recovery preserves the timeline, TTL, and footer actions while rendering only the header-state change.
- Test connected branded and neutral fallback identities, newest-first/capped activity, and current editing as the first row.
- Add visual/component coverage for neutral, connecting, and connected signal variants, including the no-motion version.

## Out of Scope

- No change to MCP protocol, authentication, pairing-code semantics, session timeout, relay behavior, or analytics payloads.
- No diagram thumbnail or new onboarding flow.
