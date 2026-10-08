# Targeted feedback survey

The Full app may show a small page banner to one verified site and account. A centrally managed KV document controls eligibility. The browser receives only the survey UUID, revision, title, question, and choice labels. The server never trusts a client-provided site, account, or app identity. The local terminal state is keyed by verified site, account, and survey UUID, so changing a revision does not prompt someone who dismissed or submitted it. Cross-device dismissal is outside this first version.

The first screen says “Help us improve ZenUML” and offers Share feedback and Dismiss. The second asks “What could we improve?” with selectable performance, editing, display, export, missing feature, and other options, plus optional explanatory text. It appears only when the existing page-banner priorities have no candidate, and it never opens a modal or interrupts editing.

| Event | Trigger | Properties at call site |
| --- | --- | --- |
| `targeted_survey_shown` | First screen becomes visible | `feature_area=feedback`, `surface=page_banner`, `survey_uuid`, `survey_revision` |
| `targeted_survey_opened` | Share feedback is selected | Same |
| `targeted_survey_dismissed` | Dismiss is selected on either screen | Same |
| `targeted_survey_submitted` | Server confirms the response | Same |
| `targeted_survey_submit_failed` | A send attempt fails | Same |

`product_type=full` is supplied by the normal analytics tracker. Events intentionally omit the target and all response content. A failed send retains the form and idempotency key for retry.

## Activation and rollback

The active configuration is a single JSON value at `targeted-survey:active` in the existing `SPACE_LICENSE_KV` namespace. Keep the real `cloudId` and `accountId` in a local file outside the repository. Use this shape, replacing every placeholder with a verified value:

```json
{
  "uuid": "<new UUID>",
  "revision": 1,
  "enabled": false,
  "product": "full",
  "cloudId": "<verified cloud ID>",
  "accountId": "<verified Atlassian account ID>",
  "startsAt": "<UTC ISO timestamp>",
  "expiresAt": "<UTC ISO timestamp>",
  "title": "Help us improve ZenUML",
  "question": "What could we improve?",
  "options": ["performance", "editing", "display", "export", "missing_feature", "other"]
}
```

Deploy the code and migration `0028_add_targeted_survey_response.sql` through the normal pipeline first. That pipeline applies D1 migrations before publishing Pages. Check the deployed `/api/targeted-survey` route with a verified Full Forge invocation before enabling a campaign. A missing migration makes the endpoint return no survey. The endpoint rejects Lite/Diagramly/AsyncAPI tokens even if they are otherwise valid for this backend. The browser also gates the lookup on `PRODUCT_TYPE=full`.

For staging, write the local JSON file with the `wrangler-stg.toml` `SPACE_LICENSE_KV` binding (use `wrangler-prod.toml` for production):

```bash
pnpm exec wrangler kv key put 'targeted-survey:active' --binding=SPACE_LICENSE_KV --path=/secure/local/targeted-survey.json --remote --config wrangler-stg.toml --env production
pnpm exec wrangler kv key get 'targeted-survey:active' --binding=SPACE_LICENSE_KV --remote --config wrangler-stg.toml --env production
```

Set `enabled: true` only when the target, window, and migration have been verified. To stop new displays, set `enabled: false` or delete the key. Keep the same UUID when editing wording or choices and increment `revision`; local dismissed/submitted state and D1 uniqueness remain tied to the UUID. Use a new UUID only for a genuinely new campaign. The first response per verified site and account wins; duplicate submissions return success without replacing it.

The server response contains only public survey fields. It does not expose the target IDs. A missing/invalid KV value, failed identity check, unavailable D1 table, failed browser storage, or failed page-property check suppresses display. Dismissal is local to a browser. A browser with cleared storage or another device may see the prompt again; D1 still prevents duplicate saved responses.
