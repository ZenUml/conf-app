# Local CRM queue drawer — implementation plan

1. Add a queue-specific drawer selection to `local-crm/src/stores/crm.tsx`.
   It must be mutually exclusive with an event selection, clear on navigation and
   close, and preserve the existing event-case drawer behaviour.
2. Add reducer tests for request drawer open/close/reset behaviour before changing
   the UI.
3. Add `QueueRequestDrawer` under `local-crm/src/components/drawer/`. Render one
   continuous flow from `QueueRow`: request header, evidence, copy-only command,
   comment metadata, ticket/tenant links, provenance/freshness. Do not add action
   controls, lifecycle stages, tabs, or comment text.
4. Make Today open a queue request through the new store method. Continue routing
   expiry rows to their existing grant event and leave the command copy action from
   opening either drawer.
5. Mount the queue drawer alongside `CaseDrawer`, with tests that protect the
   request/expiry split and absent-evidence labels.
6. Run the local CRM tests, typecheck, and build. Then conduct a loopback UI spot
   check against the live data, waiting for React to commit before evaluating the
   drawer. Do not preserve screenshots or render customer data in tracked files.

## Analytics note

This loopback-only operator console has no Mixpanel client or approved telemetry
transport. Adding a tracker that emitted requester, tenant, ticket, or cloud-ID data
would violate the privacy policy. This drawer therefore adds no event until a
privacy-safe, operator-console telemetry boundary is designed; the UI uses no write
path and does not alter production customer behavior.
