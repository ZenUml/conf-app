# Local CRM queue drawer

## Purpose

Open an extension request from the Today queue without turning it into a lifecycle
case. The operator should be able to inspect the grant decision evidence, copy the
already-filled handoff command, and route to the JSM ticket.

## Scope

- A request queue row opens a dedicated, right-side drawer.
- An expiry queue row continues to open the existing grant case drawer unchanged.
- The request drawer is one continuous scroll: header, evidence, handoff command,
  and JSM comment evidence.
- The header exposes the ticket and resolved tenant links when present.
- The evidence uses the values already carried by `QueueRow`: cloud ID, requester,
  macro count and limit, prior-grant summary, and the last-comment authorship.
- The command is copy-only. It remains the existing `extend-space-license` handoff;
  the console creates no write.

## Deliberate exclusions

- No lifecycle rail: requests have no grant lifecycle to render.
- No Audit tab: the current audit table does not establish a request action.
- No action controls or confirmation flow: the console has no approved write path.
- No comment bodies. The current contract exposes counts, last author, date, and
  authorship only. The JSM ticket link is the source for the full conversation until
  a separate contract widening explicitly adds body data.

## Data and interaction model

The CRM store keeps a queue-row selection separate from its event selection. This
lets a request with no matching grant open meaningful detail while preserving the
existing `CaseDrawer` model for grant events. Closing either drawer clears its own
selection. Clicking ticket or tenant links never opens the drawer.

The queue drawer consumes a `QueueRow` directly. It does not make a second network
request and does not infer facts from a missing grant. Missing fields are labelled as
unavailable rather than treated as negative evidence.

## Validation

Unit tests cover opening and closing the queue selection and the drawer's rendered
request evidence, command, comment metadata, and excluded controls. A loopback UI
spot check confirms a live request row opens the one-flow drawer and that its ticket
link routes outward. No customer data or evidence screenshots are committed.
