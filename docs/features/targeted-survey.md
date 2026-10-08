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
