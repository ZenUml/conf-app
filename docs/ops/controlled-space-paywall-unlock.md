# Controlled Space Paywall Unlock (Phase 1)

Phase 1 is a silent, temporary Paywall unlock for exactly one Confluence
space. It has no customer-facing copy, banner, email, or other announcement.
It uses the existing whole-space license entitlement; it does not introduce a
second feature flag or a tenant-wide exemption.

## Safety model

`functions/api/space-license.ts` stores a whole-space entitlement at
`license:<cloudId>:<spaceKey>`. `functions/api/space-status.ts` derives the
cloud ID from the Forge-authenticated request and checks that exact key. An
active, unexpired record bypasses the Lite Paywall only in that space.

Do not include `userAccountId`: that creates a requester-scoped extension,
which is not the experiment. Do not use `PAYWALL_EXEMPTIONS`: it is
tenant-wide. Keep the customer domain, cloud ID, and space key out of tracked
files and supply them only as operator runtime values.

## Operate

Before enabling, confirm the supplied cloud ID and space key against the
current production metrics for the intended Lite app. Then create a
whole-space record with an explicit seven-day expiry:

```bash
curl --fail-with-body -X POST "$BACKEND_API_BASE_URL/api/space-license" \
  -H "Authorization: Bearer $ADMIN_API_SECRET" \
  -H "Content-Type: application/json" \
  --data '{
    "cloudId": "<operator-supplied>",
    "spaceKey": "<operator-supplied>",
    "expiresAt": "<operator-supplied ISO-8601, about seven days ahead>",
    "activatedBy": "controlled-paywall-experiment-phase1"
  }'
```

The existing record expires automatically, restoring the ordinary Paywall
decision. To restore it early while retaining the record for audit, soft-delete
the same whole-space record:

```bash
curl --fail-with-body -X DELETE \
  "$BACKEND_API_BASE_URL/api/space-license?cloudId=<operator-supplied>&spaceKey=<operator-supplied>" \
  -H "Authorization: Bearer $ADMIN_API_SECRET"
```

The record remains in `SPACE_LICENSE_KV` as `inactive`; do not remove it from
the index or KV by hand. A genuine paid/license entitlement or a separate
tenant exemption can still independently bypass the Paywall, so check those
before attributing results to this experiment.

## Measurement

Use `client_domain`, `confluence_space`, and an explicit before/during/after
date range in Mixpanel. These values are automatically attached to the frontend
events; no customer identity is needed in source code.

| Question | Event / definition |
|---|---|
| Unique active users and diagram views | `macro_viewed`, distinct `user_account_id` / total events |
| Create or edit attempt | `paywall_gate_evaluated`, split by `action_type` (`page_editor_create`, `page_editor`, `byline_create`) |
| Creation or edit start | `macro_create_started` / `macro_edit_started` |
| Successful create or edit/save | `macro_create_succeeded` / `macro_save_succeeded` |
| Usage frequency | Event count per `user_account_id` in the scoped date range |
| New diagrams / modifications | `macro_create_succeeded` / `macro_save_succeeded` totals |
| Extension requests | `extension_request_clicked` |
| Previously Paywall-affected returning users | For each during-period `user_account_id`, look for an earlier scoped `paywall_triggered` event before the enable timestamp |

The funnel is **Attempt → Start → Save**. `paywall_gate_evaluated` is the
attempt anchor because it is emitted for each editor gate decision, whether the
gate fires or the active space license admits the editor. Do not substitute
Confluence page activity for macro activity.

## Verification already covered in code

The focused unit suites cover active whole-space access, expired/inactive
restoration, user-versus-space scope, and retained soft deletes:

```bash
pnpm vitest run tests/unit/space-license.spec.ts tests/unit/space-status.spec.ts src/composables/useCustomerSuccessService.spec.ts src/utils/paywall/mountPaywallGate.spec.ts
```
