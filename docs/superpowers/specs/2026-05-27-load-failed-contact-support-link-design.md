# Load-failed: "Contact support" escape-hatch link

## Problem

The generic load-failed empty state in `GenericViewer.vue` (issue #151) currently offers only a Retry button. If Retry doesn't help — because the underlying custom-content was deleted, never existed, or there's a server-side problem — the user has nowhere to go. They see "Content ID: 999999999" with no way to bring it to our attention.

The permission (403) variant (issue #152) already steers users to the right place: "Ask the page owner for read access, or contact your admin." That's a Confluence permissions issue, not a ZenUML problem, so it's deliberately excluded here.

## Goal

Give users on the generic load-failed screen a one-click path to file a support ticket with us, with the diagnostic context they would otherwise have to dig up by hand.

## Non-goals

- Pre-filling a JSD form via URL query params. JSD's `summary=` / `description=` prefill requires hardcoding a specific portalId + requestTypeId; that's brittle to JSD form changes and was rejected during brainstorming.
- Adding the same link to the permission (403) state. Most 403s are real Confluence permission issues and the message already directs the user to the right person; adding a "report to us" button would generate tickets we can't help with.
- Including build-time branch/hash in the diagnostic payload. App version + environment is sufficient for support; dev branch/hash is leaked dev-only signal and not useful in customer tickets.

## Design

### UI

In `src/components/Viewer/GenericViewer.vue` (the `v-else-if="isLoadFailed"` block currently at line 94–103), add a small secondary "Contact support →" link directly below the Retry button:

```
            ⚠
   Couldn't load this diagram
       Content ID: 999999999
          [ Retry ]
       Contact support →
```

Style: text-only link, no border, slightly muted color (matches the existing `viewer-load-failed-hint` palette). It is visually subordinate to Retry — Retry is the primary action for transient failures; support is the escape hatch when Retry has not solved it.

### Click handler

New method `contactSupport()` on the component:

```ts
async contactSupport() {
  const payload = [
    'Diagram failed to load',
    `Content ID: ${this.failedCustomContentId ?? '(unknown)'}`,
    `App version: ${import.meta.env.VITE_APP_VERSION ?? '(unknown)'} (${import.meta.env.VITE_APP_PRODUCT_TYPE ?? '(unknown)'})`,
    `Forge env: ${window.forgeGlobal?.forgeContext?.environment?.type ?? '(unknown)'}`,
    `cloudId: ${window.forgeGlobal?.forgeContext?.cloudId ?? '(unknown)'}`,
    `spaceKey: ${this.diagram?.space?.key ?? '(unknown)'}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(payload);
    toast({ message: 'Diagnostic info copied — paste into your ticket', duration: 4000 });
  } catch {
    // Clipboard can fail in non-secure contexts or with permissions denied.
    // Still open the portal; tell the user the Content ID inline so they
    // can at least attach that manually.
    toast({ message: `Couldn't auto-copy. Content ID: ${this.failedCustomContentId ?? '(unknown)'}`, duration: 6000 });
  }

  trackEvent('support_link_clicked', 'click', 'load_failed_generic', {
    content_id: String(this.failedCustomContentId ?? ''),
  });

  openUrl('https://zenuml.atlassian.net/servicedesk');
}
```

`openUrl` is the existing helper from `@/model/globals/forgeGlobal` (already used by Header's help link).

### Tracking

`support_link_clicked` Mixpanel event, category `click`, label `load_failed_generic`, with property `content_id`. This lets us measure the funnel: of N generic load failures, how many users click into support. No new event-dictionary entry is required beyond the standard event name.

### Tests (`src/components/Viewer/GenericViewer.spec.ts`)

Add a new describe block, `load-failed support link`:

1. `renders a "Contact support" link when in generic load-failed state` — set `diagramType=Unknown` (no `loadError.httpStatus`); assert the link element is present.
2. `does not render the support link in the permission (403) state` — set `diagramType=Unknown` and `loadError={httpStatus: 403}`; assert the link is absent.
3. `clicking copies diagnostic info and opens the support portal` — mock `navigator.clipboard.writeText`, `openUrl`, and `trackEvent`; click the link; assert all three were called with expected payloads (substring matches for the clipboard text; exact URL for openUrl; expected category/label/content_id for trackEvent).

Mocks for `openUrl` and `navigator.clipboard` need to be added to the existing test setup; `trackEvent` is already mocked via `@/utils/window`.

## Risk and rollout

Low risk — purely additive UI on an existing error state. No backend changes, no schema changes, no migration. Lands on the same branch as the floating-bar-hides-Retry fix (`claude/github-open-issues-133pG`).

## Out of scope (for follow-ups, not this PR)

- "Download debug bundle" affordance in the same empty state (the bundle service already exists at `src/services/debugBundle.ts`; we just hide it via the pill `v-if`). If we want it here, it's a separate decision about whether the full bundle is appropriate when the diagram never loaded.
- Tooltip on the link explaining what data gets copied. Could be added later if we observe support tickets where users seem confused about what was sent.
