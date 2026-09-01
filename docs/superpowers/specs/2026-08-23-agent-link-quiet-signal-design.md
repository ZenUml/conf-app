# Agent Link Quiet Signal Design

## Purpose

Make the fullscreen Agent Link rail a calm companion to the visible diagram. Once pairing succeeds, the rail reports the current client and recent user-facing work without turning transport state into a second task.

## Connected header

- Show the actual connected client at left and a small green dot with `Connected` at right.
- Normalize self-reported MCP client names to the fixed display labels `Codex`, `Claude Code`, or `Cursor`. Recognized clients use only licensed, installed marks.
- Unknown or untrusted names use the neutral glyph and `AI assistant`; raw names are never rendered.
- Do not repeat the diagram title in a `Linked to` row because the diagram is already visible beside the rail.

## Activity timeline

- Show at most the five newest user-facing items, newest first.
- An in-progress edit is the first timeline row, using the same row geometry as settled work. It must not create a separate banner or layout jump.
- Keep read, search, list, edit-success, and actionable failure summaries.
- Do not show WebSocket pause/resume records in the timeline; those remain diagnostic telemetry and internal state.

## Automatic recovery

Automatic WebSocket recovery does not replace, clear, or reflow the connected body. The timeline, session TTL, and explicit session actions remain mounted. Only the header status changes to amber `Connecting` with a small outward wave. There is no recovery card, countdown, help link, retry button, or explanatory paragraph while retries are still active.

The wave is disabled under `prefers-reduced-motion`; the amber dot and adjacent status text remain visible. The existing recovery-exhausted state stays actionable after retries genuinely stop.

## Component boundaries

- `AgentStatusHeader` owns safe display normalization, the client mark/label, the compact activity subline, and the connection signal.
- `ConnectPanel` owns the bounded activity timeline and preserves its body across transient recovery.
- The existing connect-tool presence and same-origin handoff paths continue carrying the current client name; raw identity is consumed only to select a fixed safe display label and is never rendered as UI.
- Existing protocol, session, pairing, feature-flag, and telemetry behavior do not change.

## Verification

- Component tests cover branded and neutral identities, newest-first/capped activity, current work first, transport-entry filtering, and same-body automatic recovery.
- Storybook covers Codex, Claude Code, a generic client, current work, and automatic recovery at the 316px rail width.
- The connected and automatic-recovery stories must be visually inspected; unit tests alone are not UI evidence.
