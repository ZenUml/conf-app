# Automatic Apply Extension

This runbook configures the two support-agent actions for ZenUML Lite temporary
editing extensions. The backend contract and policy are defined in
`docs/superpowers/specs/2026-08-19-automatic-apply-extension-design.md`.

## Safe rollout order

Do not enable either JSM rule before all backend steps are complete:

1. Deploy migration `0020_add_extension_action.sql` to the target D1 database.
2. Set a new random `EXTENSION_AUTOMATION_SECRET` on the target Cloudflare Pages
   project. Do not reuse `ADMIN_API_SECRET`.
3. Deploy the Pages build containing `/api/support/extension-actions`.
4. Probe the endpoint without a secret and confirm `401 unauthorized`.
5. Probe with the secret and an invalid request type; confirm
   `400 invalid_request_type` and no KV write.
6. Create the JSM rules below in a disabled state and inspect their generated
   payload with a non-mutating validation failure.
7. Run the first valid end-to-end action on one controlled production request,
   verify it, then leave the rules enabled.

The production endpoint is:

```text
https://conf-lite.zenuml.com/api/support/extension-actions
```

The staging endpoint is:

```text
https://conf-stg-lite.zenuml.com/api/support/extension-actions
```

**Important:** the staging and production Pages projects currently bind the same
production `SPACE_LICENSE_KV` namespace. A valid staging request would therefore
grant a production license while writing its idempotency row to staging D1. Use
staging only for requests guaranteed to fail before the write, unless a real
production grant has been explicitly selected for the test.

## Shared JSM rule settings

Create each rule under the ZEN service project's Automation settings.

- Trigger: **Manual trigger from work item**.
- Groups that can run trigger: the support-agent group only.
- Conditions:
  - project is `ZEN`;
  - request type is **ZenUML Upgrade or Extension Request** (ID `9`);
  - **Plan you're interested in** is **Temporary editing extension only**
    (`customfield_10070` option ID `10037`).
- Web request method: `POST`.
- Header: `Authorization: Bearer <EXTENSION_AUTOMATION_SECRET>`.
- Mark the Authorization value hidden.
- Header: `Content-Type: application/json`.
- Enable **Wait for response** so `{{webhookResponse.body.*}}` is populated.
- Enable **Continue running the rule even if the request response is not
  successful** so validation and temporary-failure responses reach the internal
  note branches instead of terminating the rule.

Atlassian's `asJsonString` function is required for Description because it
escapes line breaks and quotes for the JSON request body.

## Rule 1: Apply Extension

Manual-trigger name:

```text
Apply Extension
```

Custom web-request body:

```json
{
  "action": "initial",
  "ticketKey": {{issue.key.asJsonString}},
  "requestTypeId": "9",
  "planOptionId": {{issue.customfield_10070.id.asJsonString}},
  "description": {{issue.description.asJsonString}}
}
```

Handle the response with If/else blocks:

1. `{{webhookResponse.status}}` equals `200` and
   `{{webhookResponse.body.outcome}}` equals `applied`:
   - add `{{webhookResponse.body.reply}}` as a **public/customer-visible** reply;
   - do not add a transition action. The current ZEN workflow moves a request
     from Waiting for support to Waiting for customer when Automation posts a
     public reply; this was verified in the controlled E2E. Assert the resulting
     status instead of adding a redundant transition.
2. Status `200` and outcome `already_applied`:
   - add an internal note: `Apply Extension was already completed through
     {{webhookResponse.body.expiresAt}}; no duplicate customer reply was sent.
     Confirm the earlier public reply and Waiting for customer transition are
     present; if either downstream Jira action failed, complete it manually
     using {{webhookResponse.body.reply}}.`
3. Any other response:
   - add an internal note containing only status, outcome, error, and retryable:

```text
Apply Extension failed.
HTTP: {{webhookResponse.status}}
Outcome: {{webhookResponse.body.outcome}}
Error: {{webhookResponse.body.error}}
Retryable: {{webhookResponse.body.retryable}}
```

Do not include the Authorization header or the full outgoing request in a Jira
comment.

## Rule 2: Apply 60-day Feedback Extension

Manual-trigger name:

```text
Apply 60-day Feedback Extension
```

The agent runs this only after reading the customer reply and confirming it
substantively answers all four questions. The backend requires an applied initial
action for the same ticket and reuses that action's target.

Use the same request body with one change:

```json
{
  "action": "feedback",
  "ticketKey": {{issue.key.asJsonString}},
  "requestTypeId": "9",
  "planOptionId": {{issue.customfield_10070.id.asJsonString}},
  "description": {{issue.description.asJsonString}}
}
```

Response handling matches Rule 1, except a new `applied` result performs both:

1. post `{{webhookResponse.body.reply}}` publicly;
2. transition the request to **Resolved**.

An `already_applied` result receives only an internal note and does not send a
second public confirmation. The note must tell the agent to confirm the earlier
public reply and Resolved transition, and to complete a missing downstream Jira
action manually using `{{webhookResponse.body.reply}}`.

## Verification

For the first controlled request, capture all of the following before calling the
workflow verified:

- Automation audit log shows one successful web request.
- The response says `outcome=applied`, `action=initial`, and a seven-day expiry.
- The exact requester-scoped KV key reads back active:
  `license:<cloudId>:<spaceKey>:<accountId>`.
- The bare space key `license:<cloudId>:<spaceKey>` was not created.
- A customer-visible JSM reply is present with four numbered questions and the
  correct through-date.
- Running the action again returns `already_applied` and creates no second public
  reply.

The endpoint performs a same-request KV read-back before returning `applied`.
Wrangler's remote KV read can still return a transient 404 while the write
propagates between Cloudflare edges; retry that external verification for up to
one minute before treating it as a missing write.

For the feedback action, additionally verify the same KV key has the sixty-day
expiry and the request is Resolved. Backend unit tests are not evidence for the
customer-visible reply; observe the JSM request UI or comment API.
