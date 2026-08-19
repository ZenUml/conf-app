# Automatic Apply Extension

## Goal

Let a ZenUML support agent grant the standard Lite editing extension from a JSM
request with one manual action. The action must apply the existing commercial
policy, verify the production license record, reply to the customer, and be safe
to retry.

## Scope

Two JSM manual actions are supported:

- **Apply Extension** — grants the requester seven days and offers sixty days in
  exchange for answers to the four canonical product-feedback questions.
- **Apply 60-day Feedback Extension** — after an agent confirms the answers are
  substantive, renews the same requester for sixty days.

Both actions are requester-scoped. Space-wide grants and arbitrary durations
remain manual exceptions handled by the existing `extend-space-license` runbook.

## Architecture

JSM Automation owns the agent-facing actions, comments, and transitions. It sends
an authenticated command to one narrow Cloudflare Pages endpoint:

```http
POST /api/support/extension-actions
Authorization: Bearer <EXTENSION_AUTOMATION_SECRET>
Content-Type: application/json
```

```json
{
  "action": "initial",
  "ticketKey": "ZEN-1234",
  "requestTypeId": "9",
  "planOptionId": "10037",
  "description": "Request: Temporary Lite editing extension\n..."
}
```

The endpoint, not Jira, owns scope, duration, expiry calculation, validation,
reply wording, idempotency, and the production KV write. It never accepts a
`days` or space-wide-scope input. It uses a dedicated secret rather than the
general `ADMIN_API_SECRET`.

## Request validation

The endpoint:

1. accepts only `POST` with the dedicated Bearer secret;
2. accepts only request type `9` and plan option `10037`;
3. parses the labelled `Client domain`, `Space key`, and `User account ID` lines;
4. rejects missing, duplicated, placeholder, multiline, or oversized values;
5. resolves cloudId from the tenant's `/_edge/tenant_info` response;
6. requires an exact, case-sensitive space-key match in server-side metrics and a
   macro count of at least 100;
7. rejects a recent Full/Diagramly paid-rail install;
8. always writes `license:<cloudId>:<spaceKey>:<accountId>` and never the bare
   space key.

Submitted macro count, product, page ID, and app version are diagnostic only and
do not authorize a grant. Metrics uncertainty fails closed; support can use the
existing manual runbook for exceptions.

## Idempotency and recovery

D1 stores one `ExtensionAction` row per `(ticketKey, action)`. The initial insert
fixes the target and expiry before the KV write. States are `pending`, `applied`,
and `failed`.

An `initial` replay resumes or returns the original result. A `feedback` action
derives cloudId, space key, and account ID from the ticket's applied `initial`
row, not from newly supplied description text. A feedback action without an
applied initial row is rejected.

After the license write, the endpoint reads the exact key back and requires an
active record with the expected target and expiry before marking the action
applied. A retry of a pending row reuses its stored expiry. The endpoint returns
`applied` only on the first successful completion and `already_applied` on later
calls, allowing Jira to avoid duplicate public replies.

The endpoint updates `license-index` for admin listing compatibility. The
enforcement source remains `SPACE_LICENSE_KV` and `space-status.ts`.

## Responses and JSM behavior

Successful responses contain only structured fields needed by Automation plus a
canonical plain-text reply:

```json
{
  "outcome": "applied",
  "action": "initial",
  "expiresAt": "2026-08-26T23:59:59Z",
  "reply": "..."
}
```

- `applied`, initial: post `reply` publicly; leave the request waiting for the
  customer.
- `applied`, feedback: post `reply` publicly; resolve the request.
- `already_applied`: do not post publicly; add an internal idempotency note.
- `validation_failed`: add an internal note with the stable error code; do not
  transition.
- `temporary_failure`: add an internal note; leave the request retryable.

Replies contain no arbitrary user input. The initial reply includes the canonical
four feedback questions, the seven-day through-date, the sixty-day offer, and the
"no strings attached" line. The feedback reply confirms the new through-date.

## Analytics

The endpoint emits these service events after authenticating the caller:

- `extension_action_requested` — accepted command shape, before validation;
- `extension_action_succeeded` — exact license key read back active;
- `extension_action_failed` — authenticated command did not reach that state.

Properties are `feature_area=upgrade`, `surface=support_automation`,
`extension_action`, `extension_scope=user`, `extension_days`, `duration_ms`, and,
as applicable, `extension_action_outcome`, `extension_failure_stage`,
`failure_reason`, `macro_count`, `client_domain`, and `confluence_space`. Events
must never contain the ticket key, raw description, account ID, or reply text.

## Security and privacy

- The Automation secret is a dedicated Cloudflare secret and a hidden JSM web
  request value.
- JSM restricts both manual triggers to the support-agent group.
- API logs redact Authorization and never log the request description.
- Error responses use stable codes and do not echo parsed customer values.
- No real tenant identifiers are stored in repository files or test fixtures.

## Verification

Automated tests cover authentication, command and description validation, exact
space and threshold checks, requester-only key shape, fixed durations, read-back
verification, paid-rail rejection, initial and feedback replies, duplicate clicks,
pending retry, feedback target reuse, and route allowlisting.

The JSM rule is first exercised against a local/staging endpoint using a fixture
request. Production enablement requires a dry run that proves the endpoint returns
the expected result without writing production KV, followed by one controlled
support request and KV read-back. A public-reply assertion requires observing the
JSM comment; backend tests alone do not count as UI evidence.
