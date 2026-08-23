# Agent Link Quiet Signal Design

## Purpose

Make the fullscreen Agent Link rail feel like a calm companion to the diagram, not a succession of technical empty states. The user's task is always the same: let an AI agent work with the current diagram. The interface should only demand attention when the user must act.

## Visual Thesis

The connection is a small, persistent signal in the rail header. It is not a separate status page.

- **Disconnected:** neutral dot and `Connect to an AI agent` header.
- **Connecting / automatic recovery:** 8px amber dot. A translucent wave expands from the dot and fades every 1.35 seconds. The dot itself does not scale and there is no static outer ring.
- **Connected:** green dot and the normalized connected agent name.

The wave is disabled under `prefers-reduced-motion`; the amber dot remains visible. Color is never the sole status signal because the adjacent header text changes with it.

## Layout and State Behavior

### Header

The header is the durable visual anchor across all lifecycle states. It contains only the signal, state label, and—when known—the actual agent identity.

### Initial pairing

The panel body expands into one connection note:

1. A short, user-oriented title: `Hand it to your AI agent`.
2. One sentence: copy the note into the AI assistant currently in use.
3. A contained diagram-to-agent connection note, with the pairing prompt inside it.
4. One primary `Copy prompt` button.
5. `Need help?` as progressive disclosure only.

The connection note is readable context, not a second button. Hovering it must not translate or noticeably move it. At most it may receive a subtle border or shadow change. The primary button is semantic `<button>` UI with a pointer cursor, visible focus state, and modest hover feedback.

### Automatic recovery

Automatic recovery must not replace, clear, or reflow the panel body. The user continues to see the content that was already there. Only the header changes to amber `Connecting` and plays the small wave animation. There are no recovery instructions, countdowns, help links, or competing actions in this state.

### Other lifecycle states

Expired pairing, explicit disconnect, and protocol incompatibility retain the existing lifecycle-specific single-action model. They use the same header anchor but only introduce a new panel body when user action is required. User-facing copy avoids `reconnect` jargon; only the MCP incompatibility action explicitly says `Copy prompt to upgrade your MCP`.

## Component Boundaries

- `AgentStatusHeader` owns semantic state label, agent identity, signal color, and reduced-motion-safe pulse.
- `ConnectPanel` owns lifecycle-specific body content and the one primary action for actionable states.
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
- Test that automatic recovery preserves mounted panel content and renders only the header-state change.
- Add visual/component coverage for neutral, connecting, and connected signal variants, including the no-motion version.

## Out of Scope

- No change to MCP protocol, authentication, pairing-code semantics, session timeout, relay behavior, or analytics payloads.
- No diagram thumbnail or new onboarding flow.
