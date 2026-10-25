# Fullscreen contact recovery: support operations

This runbook covers the Lite Fullscreen contact pilot. The feature is **off** when its trusted KV policy is absent or disabled. These steps do not enable the pilot or send mail by themselves. The policy reuses the existing `KV_FEATURE_FLAGS` operational namespace; it does not create a new KV namespace.

Forge Developer Console flags and this KV policy have different jobs. Use Forge flags for release and test rollout of client behavior where a flag exists; a flag change is not a durable customer-operation record. Use the server-managed `fullscreen-recovery:policy:<cloudId>` key for a persistent, per-site customer policy. The backend reads it only after the trusted Lite FIT supplies the site identity. The caller supplies the current `spaceKey` as a lookup key; FIT does not attest the currently displayed Space. Recovery reads the existing `metrics:<domain>:lite` KV count used by Fullscreen's current limit decision and reads entitlements separately. A legacy metrics entry can be written through the existing authenticated browser update route, so this count is an existing product dependency, not an independently tamper-proof server inventory. D1 remains the source for requests, grants, and support audit history.

## What the grant does

One request and one initial grant are stored per `(cloudId, accountId, fullscreen)`. A successful Fullscreen view receipt activates the grant for 168 hours; simply submitting the form does not start it. At the expiry instant a new Fullscreen open is gated. An already open view continues. Embedded reading and edit permissions are separate. A customer's reply or a mail delivery event never extends the grant. Support can extend it from `max(serverNow, currentExpiresAt)` for 14 days with an audited, idempotent command.

## Deployment and configuration gates

1. Apply `functions/migrations/0033_fullscreen_recovery.sql` and then `0034_fullscreen_recovery_mail.sql` through the normal CI migration gate. Verify the same candidate build serves the Lite backend. Do not deploy staging from a local shell.
2. Configure `FULLSCREEN_RECOVERY_ENCRYPTION_KEY` as a base64-encoded 32-byte secret. It encrypts the request email and note and mail snapshots. Preserve it securely across deployments; losing it makes stored contact data unreadable.
3. Configure `FULLSCREEN_RECOVERY_SUPPORT_TOKENS` as a JSON object mapping stable operator IDs to distinct, long bearer secrets, for example `{"operator-id":"<secret>"}`. Access to the support API is independent of Forge FIT and is reserved for trusted support staff. Rotate individual tokens when access changes. The customer frontend must not receive one.
4. Configure and verify `RESEND_API_KEY`, `RESEND_FROM` on a verified sending domain, `RESEND_REPLY_TO` on a mailbox that someone handles, and `RESEND_WEBHOOK_SECRET`. Check the actual Resend domain settings in the provider control plane: **open tracking off** is a release gate; verify click tracking off for this transactional domain too. Check the from and reply-to identities and signed webhook path with authorized internal test mail before any customer send. Do not change a shared domain setting without checking its other mail flows.
5. Set the server-managed `KV_FEATURE_FLAGS` key `fullscreen-recovery:policy:<cloudId>` only after the pilot gates are satisfied. Its JSON is `{ "enabled": true }`, with optional `exemptionOverrideReviewed`. Enabling the policy makes recovery immediately eligible only when the existing current Space metric reports at least 100 diagrams, paid status is known to be false, and the remaining pilot conditions pass. A count below 100, missing or invalid count, paid access, or an unreviewed exemption keeps ordinary Fullscreen access; no contact popup or temporary grant is needed. A site-user grant from another space, including an expired grant, does not limit ordinary access in this space. GET, request, and activation carry the current source `spaceKey`; the backend reads that Space's stored count and paid status before issuing a recovery state or changing a grant. Plan and usage preserves that source space and does not offer a new request without confirmed eligibility. There is no advance-notice or scheduled enforcement phase. Keep the key absent or `enabled: false` until validation and pilot approval are complete. An existing `PAYWALL_EXEMPT` exemption remains in force by default. Only after a human verifies that the exemption is not a paid or contractual commitment may the pilot policy explicitly set `exemptionOverrideReviewed: true` for that site. Missing or false means no override. Disabling the policy restores the existing fail-open path without deleting requests or audit history. Do not change `PAYWALL_EXEMPT` or editor/Space license policy for this pilot. `SPACE_LICENSE_KV` is not a fallback for this policy; it remains the space-license store.
6. Use the existing Lite macro-count cache. Recovery applies the same `>=100` threshold to its current Space `total`, whether the entry came from the legacy browser update path or the scheduled snapshot. It adds no R2-completion or 24-hour freshness condition. A missing or invalid cache entry leaves ordinary Fullscreen available and creates no grant.
7. Confirm the chosen site and account are eligible, and confirm the current paid or committed-license path before enabling a restriction. The support workflow needs a named person to review pending cases. Review the privacy retention and deletion treatment for contact text and encrypted email before the pilot.

The local implementation and automated tests do not establish real Resend account access, a verified domain, actual receipt, reply routing, or customer-facing acceptance. Complete those checks with authorized internal mailboxes. Confluence UI validation still follows Storybook → Forge Tunnel → CI-deployed Staging, with visual evidence at each stage. Production policy remains off until those gates pass. This code change performs no remote KV mutation or deployment.

## CLI setup

Use `scripts/fullscreen-recovery-support.mjs` from a secure local terminal. Set these environment variables through your approved secret manager or a protected terminal session; never put the bearer token in an argument, URL, committed file, or shared log:

```sh
export FULLSCREEN_RECOVERY_API_URL=https://conf-stg-lite.zenuml.com
# Set FULLSCREEN_RECOVERY_OPERATOR_TOKEN from the secret manager in this session.
node scripts/fullscreen-recovery-support.mjs help
```

The CLI accepts only the exact HTTPS origins `conf-stg-lite.zenuml.com`, `conf-lite.zenuml.com`, and `zenapi.zenuml.com`, plus loopback development origins. It rejects redirects. Use the staging URL for a staging case and the production URL only after the release gates. The API URL must have no path or query.

Case details, previews, and input files can contain personal contact information. Keep them in the approved support workspace, avoid copying them into tickets or analytics, and remove temporary local copies according to the team's retention process. The pending list is bounded to 50 oldest unresolved cases; use a known case ID for detail lookup.

## Read a case and its first reply

```sh
node scripts/fullscreen-recovery-support.mjs list
node scripts/fullscreen-recovery-support.mjs show --id <request-uuid>
node scripts/fullscreen-recovery-support.mjs preview --id <request-uuid> --time-zone Australia/Melbourne
node scripts/fullscreen-recovery-support.mjs status --id <request-uuid>
```

`preview` returns the actual recipient, subject, body, `previewHash`, and whether the reply snapshot is frozen. Check all of them before confirming a send. The preview states whether the grant is pending, active, or expired. `status` shows the actual mail state; `accepted` is a provider acceptance, and `delivered` is not proof that the customer read the message. `delivery_unknown` requires provider-side investigation.

## Mutations: input file, dry run, confirm

Write one JSON body to a private file (`umask 077` before creating it). The CLI checks exact body fields. Running without `--confirm` validates the file and prints only a compact dry-run summary; it makes no network request. Add `--confirm` only after checking the case, body, and intended effect. Keep each `commandId` unchanged when retrying an extension or outcome action; replacing it creates a separate action.

For a first reply, copy the `previewHash` and `timeZone` from the preview you approved:

```json
{"action":"send","requestId":"<request-uuid>","previewHash":"<64 lowercase hex characters>","timeZone":"Australia/Melbourne"}
```

```sh
node scripts/fullscreen-recovery-support.mjs send --input ./private-send.json
node scripts/fullscreen-recovery-support.mjs send --input ./private-send.json --confirm
```

The server compares the hash to the current preview and freezes the confirmed snapshot. If it changed, preview again and review the new content. The same confirmed reply is used on retries; never prepare a second message to bypass an unknown outcome.

A definite retryable `failed` state can be retried with `{"action":"retry","requestId":"<request-uuid>"}`. A stale `sending` claim can be marked for manual provider review with `{"action":"mark_unknown","requestId":"<request-uuid>"}`; the server requires the claim to be at least two minutes old. Neither action should be used to guess whether an unknown provider request was accepted. Inspect provider records first.

```sh
node scripts/fullscreen-recovery-support.mjs retry --input ./private-retry.json
node scripts/fullscreen-recovery-support.mjs retry --input ./private-retry.json --confirm
node scripts/fullscreen-recovery-support.mjs mark_unknown --input ./private-unknown.json --confirm
```

For a support-approved extension, use a new stable command UUID and a concrete reason. The server computes the 14-day deadline and audits the authenticated operator:

```json
{"action":"extend","requestId":"<request-uuid>","commandId":"<command-uuid>","reason":"Support-approved extension; reference kept in private support record"}
```

Record an actual communication outcome only after the support mailbox or case record provides evidence. Allowed `supportOutcome` values are `customer_replied`, `next_step_agreed`, and `closed`:

```json
{"action":"outcome","requestId":"<request-uuid>","commandId":"<command-uuid>","reason":"Reply received in the original thread","supportOutcome":"customer_replied"}
```

```sh
node scripts/fullscreen-recovery-support.mjs extend --input ./private-extension.json --confirm
node scripts/fullscreen-recovery-support.mjs outcome --input ./private-outcome.json --confirm
```

Keep raw customer text out of Mixpanel and CLI dry-run output. The support action reason is stored in the private D1 audit record. A customer's click on “continue the conversation” is not a recorded reply.


## Provider references checked during implementation

- [Resend idempotency](https://resend.com/changelog/idempotency-keys): provider keys last 24 hours. Our database outbox remains the durable deduplication authority; unknown delivery is never blindly retried.
- [Domain tracking settings](https://resend.com/docs/api-reference/domains/update-domain): `open_tracking` and `click_tracking` are domain configuration. Not emitting tracking events in app code alone does not prove tracking is disabled at the provider.
- [Signed webhooks](https://resend.com/changelog/managing-webhooks-via-api): verify Svix headers against the unchanged raw request body.
