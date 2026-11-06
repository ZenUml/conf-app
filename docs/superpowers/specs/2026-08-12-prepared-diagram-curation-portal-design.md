# Prepared diagram curation portal

**Date:** 2026-08-12  
**Status:** Approved design; implementation pending

## Goal

Give the internal ZenUML team a safe workflow to select a Confluence page, generate one useful Mermaid diagram from the relevant part of that page, review and correct it, and publish it as the page's prepared-diagram byline.

The user job is fast understanding of one important idea on a dense page. The diagram does not need to represent the whole page. No AI output is exposed to customers until an internal reviewer approves it.

## Rollout

The first release supports Diagramly only. The underlying data model, APIs, token leases, audit log, and publication state machine are product-neutral from the start. Later releases remove the Diagramly query/UI filter to support Lite and Full. AsyncAPI is excluded because it does not ship the prepared-diagram byline.

Each candidate targets exactly one Forge installation. If a tenant has multiple eligible apps, the reviewer selects one target product; approval never fans out automatically.

## Deployment boundary and authentication

Deploy the portal and its API as a dedicated Cloudflare Worker or Pages project at `ops.zenuml.com`. Do not place it under the public Lite or Full backends and do not expose it through a customer's Forge admin UI.

Cloudflare Access protects the complete hostname:

- Use Cloudflare as the identity provider.
- Restrict sign-in to members of the vendor's Cloudflare account.
- Apply an explicit per-person reviewer allowlist, not an all-members rule.
- Require Cloudflare MFA and use a four-hour Access session.
- Default deny all users and service credentials that do not match a policy.

The origin validates the `Cf-Access-Jwt-Assertion` signature, issuer, audience, and expiry on every API request. Reviewer identity comes only from the validated JWT; a browser-provided `reviewedBy` value is ignored. State-changing requests also require an allowed `Origin` and a CSRF token.

Portal responses use `Cache-Control: no-store`. Customer content, tokens, and candidate drafts are never written to browser local storage. Automated generation workers may use a separately scoped service credential, but service credentials cannot call approve, reject, replace, or rollback operations.

## Manual intake

The pilot intake form has two fields:

- Client domain: accepts a bare subdomain or an `atlassian.net` hostname and normalizes it to the canonical hostname.
- Page ID: ASCII digits only.

Intake is deliberately two-step:

1. Resolve the domain through `AtlassianInstance`, find eligible `ForgeInstallation` rows, and read the current page using the target installation's valid app-system token.
2. Show the actual tenant, page title, current page version, and target product. The reviewer confirms these values before selecting **Generate candidate**.

The portal does not require or persist a complete Confluence page URL. A page link for reviewer convenience is constructed at render time from the normalized domain and page ID.

The first generation attempt produces one best candidate. A reviewer may request **Generate alternative**, creating another candidate for the same page and target installation. Multiple candidates may coexist, but only one revision may be published for a page and target installation at a time.

## Page input and generation

The generation job reads the current Confluence page body as the app and records the page version used. It converts storage-format content into bounded plain text while preserving useful structure such as headings, lists, tables, and ordered steps. It excludes app chrome and unrelated metadata.

The job uses Cloudflare Workers AI and returns a schema-validated object:

```json
{
  "relevantExcerpt": "…",
  "fullTopic": "the release process across staging and production",
  "shortTopic": "Release process",
  "diagramType": "Mermaid",
  "diagramSource": "flowchart TD\n…"
}
```

The model must choose a useful subset when only part of the page benefits from visualization. It must not force the whole page into one diagram. Record the model ID, prompt version, generation timestamp, attempt number, and source page version with every candidate.

The first release accepts Mermaid only. Validate the generated source with the same Mermaid parser version used by the product. One bounded repair attempt may receive the parser error and return corrected source. A candidate that still fails parsing enters `generation_failed` and cannot be reviewed or published until regeneration succeeds.

The generation worker uses Cloudflare Queues. Enqueue and completion are idempotent by candidate ID and attempt number. Retries never create duplicate candidates or publish content.

## Review experience

The review screen shows three coordinated panes:

- The relevant source excerpt and source page identity/version.
- Editable Mermaid source, full topic, and short topic.
- A live read-only diagram preview plus the resulting byline title and tooltip.

The reviewer may:

- **Approve and publish** a new candidate.
- **Replace published diagram** when another revision is already active.
- Make lightweight edits to Mermaid source or either topic before approval.
- **Generate alternative** from the same current page version.
- **Regenerate** after a failure or source change.
- **Reject**, with a required reason.
- **Rollback** to a previously published revision.

This is not a full end-user diagram editor. It does not support DrawIO or other heavy editors in the first release.

Approval is single-reviewer for the pilot. Mermaid parsing, rendered preview, source-version checks, named reviewer audit, and revision history remain mandatory. The schema leaves room for a future tenant policy requiring two distinct reviewers.

## Byline copy

Follow the approved prepared-diagram copy design in `2026-08-12-prepared-diagram-byline-copy-design.md`:

- Use `{short topic} diagram` when the complete title is no more than 30 Unicode code points.
- Use `Explore visually` when the short topic is missing, invalid, or too long.
- Never truncate or display an ellipsis.
- Always use `Understand {full topic} at a glance` as the tooltip.
- Keep the existing purple sparkle-and-diagram icon.

The content property value contains both presentation and consistency metadata:

```json
{
  "v": 2,
  "title": "Release process diagram",
  "tooltip": "Understand the release process across staging and production at a glance",
  "revisionId": "pdrev_…",
  "sourcePageVersion": 42
}
```

The manifest retains the `entityPropertyExists` gate and adds `contentPropertyKey: zenuml-prepared-diagram`. It keeps the icon static in the manifest. Do not use `dynamicProperties`.

## Publication state machine

Candidate states are:

```text
queued → generating → pending_review
                    ↘ generation_failed
pending_review → approved → publishing → published
              ↘ rejected   ↘ awaiting_publish
              ↘ source_changed         ↘ publish_failed
published → stale
```

Before approval, re-read the current Confluence page version. If it differs from the candidate's source version, transition the candidate to `source_changed`, do not allow force-publish, and enqueue a new generation from the current version.

Published diagram revisions are immutable. Editing an approved result or rolling back creates or activates another revision; it never mutates historical evidence.

Publishing is a compensating workflow because D1 and Confluence content properties cannot participate in one transaction:

1. Reconfirm the target installation, page version, and reviewer authorization.
2. Validate topics and Mermaid source again.
3. Insert the immutable `PreparedDiagramRevision` and save the previous active revision/property as compensation inputs.
4. For a replacement, delete the old property temporarily so an old label can never open new D1 content during the switch. A first publication already has no property.
5. Update the current prepared-diagram row/publication pointer in D1.
6. Create `zenuml-prepared-diagram` with the new dynamic copy, revision ID, and source version.
7. Mark the publication `published` and write the audit entry.

If any operation from step 4 onward fails, restore both the previous D1 pointer/row and the exact previous property. A failed first publication leaves no property and therefore no byline. The byline may be absent briefly during a successful replacement, but its label and diagram body are never allowed to refer to different revisions. Every step is idempotent by publication-operation ID, and retry reconciliation compares the revision ID in D1 with the revision ID in the property before taking another action.

The existing read endpoint continues to serve the active D1 publication. It must return the full topic and label metadata with the diagram so `activation_served` can record the selected copy and `byline_topic`.

## App-system token leases

The central portal cannot call a customer's Confluence API using Cloudflare identity. It uses short-lived Forge `appSystemToken` leases scoped to an installation.

Reuse `remote-page-behavior-endpoint`, which already requests an app-system token. Add an hourly scheduled trigger that targets this endpoint for Lite, Full, and Diagramly; strip it from AsyncAPI. The `/forge-user-behavior` handler distinguishes scheduled heartbeats from page-update events, verifies the Forge invocation, then stores:

- installation ID, app ID, environment, cloud ID, and Atlassian API base URL;
- encrypted app-system token;
- token expiry and last-seen timestamp.

Do not add or modify a Forge endpoint solely for the heartbeat. This avoids an endpoint-definition change. Confirm the actual Forge deployment classification from deployment output before release rather than assuming it.

Encrypt tokens at rest with an environment-held key and authenticated encryption. Store a key ID with each ciphertext to support rotation. Never return tokens to portal clients or log token/header values. Delete expired leases automatically and reject a lease when any installation identity field does not match the candidate target.

Approval normally publishes immediately. If no valid lease exists, it enters `awaiting_publish`; the next heartbeat resumes the idempotent operation. This is a safe fallback, not an approval bypass.

## Automatic invalidation and regeneration

Reuse `avi:confluence:updated:page`; do not rely on frontend execution. For every page update:

1. If no `zenuml-prepared-diagram` property exists, do no invalidation work.
2. If the new page version is greater than the property's `sourcePageVersion`, delete the property immediately so the stale byline is hidden.
3. Notify the backend to mark the active publication `stale`, retaining its immutable revision.
4. Forward the new page snapshot and enqueue a replacement candidate.
5. Generate automatically, but stop at `pending_review`.

Any page version change invalidates the diagram in the first release, including an apparently unrelated edit. Duplicate events are harmless. A failure to delete the property is retried and appears in the portal as `stale_hide_failed`.

No regenerated diagram becomes visible until an internal reviewer approves it. Later relevance automation may be considered only after measured approval data supports it.

## Storage and retention

Use the existing shared product D1 for product/installation mapping and curation metadata. Deploy the ops portal separately and bind it to that D1. Use a dedicated R2 bucket for temporary curation material so lifecycle rules are independent of analytics snapshots.

Retention rules:

- Full page body: temporary generation input only; delete after generation completes or fails terminally.
- Relevant source excerpt: retain while review is open and for 30 days after approval or rejection, then delete.
- Mermaid source, full/short topics, candidate metadata, review decisions, publication revisions, and audit records: retain long-term for rollback and accountability.
- App-system tokens: retain only until their embedded expiry.

The existing page-capture R2 path may supply a matching current snapshot, but curation must verify its page version and must not extend the retention of that general-purpose snapshot. A missing or stale snapshot falls back to an authenticated Confluence read.

## Data model

All identifiers are opaque generated IDs. At minimum add:

### `CurationCandidate`

`id`, `cloudId`, `pageId`, `sourcePageVersion`, `appId`, `installationId`, `productType`, `status`, `diagramType`, `diagramSource`, `fullTopic`, `shortTopic`, `excerptObjectKey`, `modelId`, `promptVersion`, `attemptNumber`, `createdAt`, `updatedAt`, `decidedAt`, `decidedBy`, `decisionReason`.

### `PreparedDiagramRevision`

`id`, target installation/page identity, immutable Mermaid source/topics/copy, source page version, originating candidate, reviewer identity, review timestamp, and creation timestamp.

### `PreparedDiagramPublication`

One row per target installation/page, with `activeRevisionId`, publication state, stale timestamp/reason, last operation ID, and update timestamp.

### `CurationAuditLog`

Append-only reviewer/action record containing candidate/revision/publication IDs, action, timestamp, reason, and a structured before/after change set. Do not duplicate the source excerpt or full page body into the audit log.

### `ForgeTokenLease`

Installation identity, encrypted token, key ID, expiry, and last-seen time. This table is never exposed through read APIs to the browser.

Keep the existing `PreparedDiagram` table as the compatibility read model for the first release. Publication projects the active immutable revision into that row. Changing the customer read endpoint to join `PreparedDiagramPublication` directly is out of scope.

## Analytics

Analytics events are part of the feature and are implemented first. The first feature commit adds event names to `src/utils/analytics/catalog.ts` and typed properties to `src/utils/analytics/types.ts` before implementation code.

Events:

- `curation_candidate_generation_requested`
- `curation_candidate_generated`
- `curation_candidate_generation_failed`
- `curation_review_decided`
- `curation_publish_succeeded`
- `curation_publish_failed`
- `curation_publication_staled`

Key properties include `product_type`, `macro_type`, `outcome`, `review_action`, `generation_attempt`, `prompt_version`, `model_id`, latency buckets, source-change reason, and publish-failure stage. Send the real full topic as `byline_topic` where a topic exists, including `activation_served` in the customer flow. Do not send full page bodies, source excerpts, Mermaid source, page titles, tenant hostnames, tokens, or raw errors that may contain customer content.

Do not create a byline-impression event: Confluence renders the chip and the app has no trustworthy render hook. Analytics signals must distinguish a generated candidate, an approved publication, a byline click, and a completed user outcome; none alone proves that a user understood the page.

## Operational defaults

Queue ordering and filters are adjustable defaults rather than architecture:

- `publish_failed` and invalidation replacements appear first.
- Remaining pending reviews are oldest first.
- Filters include tenant, product, state, and reviewer.

Every API mutation has an operation ID, structured error code, and safe retry. Portal logs use opaque IDs and stages rather than customer content. Sentry reports redact request bodies and token headers.

## Acceptance criteria

- An allowlisted Cloudflare account member with MFA can open the portal; other account members and service credentials cannot perform review actions.
- A reviewer can resolve a Diagramly page from client domain and page ID, confirm its identity/version, and generate one Mermaid candidate.
- The candidate displays its relevant excerpt, editable source/topics, live preview, final byline, and tooltip.
- Invalid Mermaid cannot be approved.
- A changed source page version blocks approval and creates a replacement candidate.
- Approval publishes the D1 read model and versioned content property; the byline opens the approved Mermaid diagram.
- Replacement may hide the byline during the switch, restores the previous revision/property on failure, never mismatches label and body, and supports rollback after success.
- A page update automatically hides the byline, marks the publication stale, and generates a new candidate without publishing it.
- Approval without a current token lease waits safely and resumes after a heartbeat.
- Candidate and publication rows are installation-scoped; no operation can cross tenant or product identity.
- Full bodies and excerpts follow their deletion schedules; immutable diagrams/topics/audit history remain available.
- Mixpanel receives the real `byline_topic` but none of the prohibited customer-content fields.
- The pilot UI is Diagramly-only while schema and APIs require an explicit target installation and can later support Lite and Full without migration.

## Out of scope for the first release

- Automatic tenant/page discovery or fleet-wide page scoring.
- Auto-approval, relevance-based exemption from invalidation, or two-person approval.
- Diagram types other than Mermaid.
- A full diagram editor.
- Customer-facing curation controls.
- Publishing one candidate to multiple products.
