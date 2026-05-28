# Load-failed: "Contact support" escape-hatch link

## Problem

The generic load-failed empty state in `GenericViewer.vue` (issue #151) currently offers only a Retry button. If Retry doesn't help — because the underlying custom-content was deleted, never existed, or there's a server-side problem — the user has nowhere to go. They see "Content ID: 999999999" with no way to bring it to our attention.

Atlassian's custom content API often collapses inaccessible or missing content into a not-found style response, so the viewer cannot reliably distinguish "deleted", "not visible to this user", stale reference, migration/orphan state, or temporary platform failure. The message must avoid over-diagnosing the cause.

## Goal

Give users on the load-failed screen a one-click path to file a support ticket with us, with the diagnostic context they would otherwise have to dig up by hand. This includes likely Confluence permission cases because support contact is still useful for customer discovery and triage.

## Non-goals

- Pre-filling a JSD form via URL query params. JSD's `summary=` / `description=` prefill requires hardcoding a specific portalId + requestTypeId; that's brittle to JSD form changes and was rejected during brainstorming.
- Trying to classify the visible empty state as a definite permission, deletion, or corruption case. The API response is not reliable enough for that.
- Including build-time branch/hash in the diagnostic payload. App version + environment is sufficient for support; dev branch/hash is leaked dev-only signal and not useful in customer tickets.

## Design

### UI

In `src/components/Viewer/GenericViewer.vue` (the `v-if="isLoadFailed"` block), show a single generic load-failed state with a small secondary "Contact ZenUML support →" link directly below the Retry button:

```
             ⚠
   We can't display this diagram
ZenUML couldn't read the diagram data
        for your account.
       Content ID: 999999999
          [ Retry ]
   Contact ZenUML support →
```

Body copy:

> ZenUML couldn't read the diagram data for your account. You might not have permission to view the source content, or the diagram data may no longer be available.
>
> Other users may still be able to view it.

Style: text-only link, no border, slightly muted color (matches the existing `viewer-load-failed-hint` palette). It is visually subordinate to Retry — Retry is the primary action for transient failures; support is the escape hatch when Retry has not solved it.

### Click handler

New method `contactSupport()` on the component:

```ts
async contactSupport() {
  const ctx = window.forgeGlobal?.forgeContext ?? {};
  const extension = ctx?.extension ?? {};
  const payload = [
    "ZenUML couldn't display a diagram",
    `Custom content ID: ${this.failedCustomContentId ?? '(unknown)'}`,
    `Page ID: ${extension?.content?.id ?? '(unknown)'}`,
    `Macro UUID: ${ctx?.localId ?? '(unknown)'}`,
    `Space: ${getSpaceKey() || '(unknown)'}`,
    `Client domain: ${getClientDomain() || '(unknown)'}`,
    `Module key: ${ctx?.moduleKey ?? '(unknown)'}`,
    `App version: ${import.meta.env.VITE_APP_VERSION ?? '(unknown)'} (${import.meta.env.PRODUCT_TYPE ?? '(unknown)'})`,
    `Forge env: ${ctx?.environmentType ?? ctx?.environment?.type ?? '(unknown)'}`,
    `Cloud ID: ${ctx?.cloudId ?? '(unknown)'}`,
    `Direct fetch status: ${this.loadError?.directFetchStatus ?? '(unknown)'}`,
    `Load error status: ${this.loadError?.httpStatus ?? '(unknown)'}`,
    `Load error code: ${this.loadError?.errorCode ?? '(unknown)'}`,
    `Load error class: ${this.loadError?.errorClass ?? '(unknown)'}`,
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
2. `still renders the support link when the loader reports a permission-like error` — set `diagramType=Unknown` and `loadError={httpStatus: 403}`; assert the same generic state and support link are present.
3. `clicking copies diagnostic info and opens the support portal` — mock `navigator.clipboard.writeText`, `openUrl`, and `trackEvent`; click the link; assert all three were called with expected payloads (substring matches for the clipboard text; exact URL for openUrl; expected category/label/content_id for trackEvent).

Mocks for `openUrl` and `navigator.clipboard` need to be added to the existing test setup; `trackEvent` is already mocked via `@/utils/window`.

## Risk and rollout

Low risk — purely additive UI on an existing error state. No backend changes, no schema changes, no migration. Lands on the same branch as the floating-bar-hides-Retry fix (`claude/github-open-issues-133pG`).

## Out of scope (for follow-ups, not this PR)

- "Download debug bundle" affordance in the same empty state (the bundle service already exists at `src/services/debugBundle.ts`; we just hide it via the pill `v-if`). If we want it here, it's a separate decision about whether the full bundle is appropriate when the diagram never loaded.
- Tooltip on the link explaining what data gets copied. Could be added later if we observe support tickets where users seem confused about what was sent.
