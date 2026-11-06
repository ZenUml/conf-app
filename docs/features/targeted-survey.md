# Targeted feedback survey

The Lite and Full apps may show a small page banner to one verified site and account. A centrally managed KV document controls eligibility. The browser receives only the survey UUID, revision, expiry, title, question, and choice IDs and labels. The server never trusts a client-provided site, account, or app identity. Both apps use the same staging D1 and the same production D1: `wrangler-stg.toml` and `wrangler-prod.toml` define one database per environment, and the publish action changes only the Pages project name. A D1 pending lease keyed by survey UUID, revision, verified site, and verified account arbitrates across Lite, Full, browsers, and devices. A rendered banner confirms display with its lease token; that revision is then reserved permanently. Incrementing the revision permits a new display.

The first screen says “Help us improve ZenUML” and offers Share feedback and Dismiss. The second asks “What could we improve?” with selectable performance, editing, display, export, missing feature, and other options, plus optional explanatory text. It appears only when the existing page-banner priorities have no candidate, and it never opens a modal or interrupts editing.

| Event | Trigger | Properties at call site |
| --- | --- | --- |
| `targeted_survey_claim_requested` | Eligible banner attempts its one-time server display claim | `feature_area=feedback`, `surface=page_banner`, `survey_uuid`, `survey_revision` |
| `targeted_survey_claim_failed` | Claim loses to another app or cannot be confirmed | Same, plus `survey_claim_result=already_claimed/unavailable/invalid_response` |
| `targeted_survey_shown` | First screen becomes visible | `feature_area=feedback`, `surface=page_banner`, `survey_uuid`, `survey_revision` |
| `targeted_survey_opened` | Share feedback is selected | Same |
| `targeted_survey_dismissed` | Dismiss/Close is selected on either screen, including while sending | Same, plus `survey_phase=invite/form/submitting` |
| `targeted_survey_submit_requested` | Send feedback is selected with a nonempty answer | Same |
| `targeted_survey_submitted` | Server confirms the response | Same |
| `targeted_survey_submit_failed` | A send attempt fails | Same |

`product_type` is supplied by the normal analytics tracker as `lite` or `full`. Events intentionally omit the target and all response content. The server grants a 15-second pending lease after the existing banner and page-property checks. The first screen renders with controls disabled; after a visible paint opportunity, the browser confirms display with its token. The banner self-hides before pending lease expiry if confirmation is unresolved. A page closed before confirmation can be offered the same revision after the lease expires. A confirmed display reserves that revision, even if the page later crashes. A failed claim never displays. A failed send retains the form, claim token, and idempotency key for retry while the form remains open. Closing during a send permanently dismisses the banner. A later confirmed server response still counts as submitted; it does not reopen the banner. D1 is the display and response source of truth; browser outcome telemetry after closure is best effort.

## Activation and rollback

The active configuration is a single JSON value at `targeted-survey:active` in the existing `SPACE_LICENSE_KV` namespace. Keep the real `cloudId` and `accountId` in a local file outside the repository. Use this shape, replacing every placeholder with a verified value:

```json
{
  "uuid": "<new UUID>",
  "revision": 1,
  "enabled": false,
  "products": ["lite", "full"],
  "cloudId": "<verified cloud ID>",
  "accountId": "<verified Atlassian account ID>",
  "startsAt": "<UTC ISO timestamp>",
  "expiresAt": "<UTC ISO timestamp>",
  "title": "Help us improve ZenUML",
  "question": "What could we improve?",
  "options": [
    { "id": "performance", "label": "Loading or responsiveness" },
    { "id": "editing", "label": "Editing diagrams" },
    { "id": "display", "label": "Display or layout" },
    { "id": "export", "label": "Exporting or sharing" },
    { "id": "missing_feature", "label": "A feature I need is missing" },
    { "id": "other", "label": "Something else" }
  ]
}
```

Deploy the code and migrations `0029_add_targeted_survey_response.sql`, `0030_add_targeted_survey_claim.sql`, and `0031_targeted_survey_revision_lease.sql` through the normal pipeline first. That pipeline applies D1 migrations before publishing Pages. Check the deployed `/api/targeted-survey` route with verified Lite and Full Forge invocations before enabling a campaign. A missing migration makes the endpoint return no survey. The endpoint rejects Diagramly/AsyncAPI tokens even if they are otherwise valid for this backend. The browser gates the lookup on `PRODUCT_TYPE=lite` or `full`. This replaces the earlier draft's `product: "full"` configuration with `products: ["lite", "full"]`; the old shape is invalid and will not activate a survey.

For staging, write the local JSON file with the `wrangler-stg.toml` `SPACE_LICENSE_KV` binding (use `wrangler-prod.toml` for production):

```bash
pnpm exec wrangler kv key put 'targeted-survey:active' --binding=SPACE_LICENSE_KV --path=/secure/local/targeted-survey.json --remote --config wrangler-stg.toml --env production
pnpm exec wrangler kv key get 'targeted-survey:active' --binding=SPACE_LICENSE_KV --remote --config wrangler-stg.toml --env production
```

Set `enabled: true` only when the target, window, and migrations have been verified. To stop new displays, set `enabled: false` or delete the key. Keep the same UUID when editing wording or choices and increment `revision`; the new revision can be shown again. Use a new UUID only for a genuinely new campaign. The first response per verified site, account, UUID, and revision wins; retries with the same submission ID return success without replacing it. The claiming app receives a token; only that app can confirm display, dismiss, or submit with it. Explicit dismissal and confirmed submission suppress the same revision permanently.

The eligibility response contains only public survey fields. It does not expose target IDs or a claim token. A missing/invalid KV value, failed identity check, unavailable D1 table, or failed page-property check suppresses display. D1 confirmation suppresses repeated prompts even if browser storage is cleared or the user opens the other product or another device. Local storage and Web Locks only coordinate tabs within one Forge app origin. If dismissal cannot reach D1, the confirmed display still prevents a repeat for that revision; the browser retries the dismissal while open. Migration 0031 does not map legacy 0030 claims to a revision. Before rollout, verify whether any campaign was activated under 0030. If so, migrate those recipients for the active revision before enabling the new route.
