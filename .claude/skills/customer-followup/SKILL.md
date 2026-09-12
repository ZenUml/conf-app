---
name: customer-followup
description: Screen and follow up Confluence app customers using lifecycle, feedback, license, usage and conversation evidence. Use for customer prioritisation, conversion, retention, win-back, paused accounts, drafting follow-ups, or updating the customer tracker after an authorised action. Reuses existing query skills; respects the user's actual authorisation scope.
---

# Customer follow-up

Turn verified customer facts into one useful next step. Keep business decisions independent of the storage tool.

## Start with the current task

Read [shared evidence rules](../customer-data/evidence.md), [contact and action policy](references/contact-policy.md), and [record contract](references/records.md). For a batch, use `1by1` for review pace; existing explicit authorisation remains valid.

1. Identify the requested customer(s), product(s), purpose, time window and already authorised actions from this conversation. Do not ask the user to repeat them. For a general recent scan, use the last seven complete days and state the timezone; expand to 30 days when useful and label the change.
2. Read the existing opportunity and activity records first. Check outstanding drafts, scheduled messages, promises, pause conditions and previous declines before preparing another contact. History search supplies context; original systems establish current state.
3. Fetch only evidence needed for the decision:
   - **Recent changes:** `customer-lifecycle`.
   - **User opinions, problems, requests:** `customer-feedback`.
   - **Site/product/license/payment/contact:** `tenant` and `marketplace`.
   - **Engagement:** `mixpanel` / `duckdb-mixpanel`; `client-health` is a Lite-only relative shortlist, not a conversion probability.
   - **Space inventory:** `macro-count`, with its coverage limitations in the shared rules.
   - **Communication:** Gmail, support tickets and `search-conversation-history`.
4. Resolve contact role separately from site identity. A Marketplace technical contact can be an employee, a partner, an ex-employee or an unknown role. Never label them site admin without evidence.

## Decide, with evidence

Give the customer name, goal, strongest signal, contactability, blocker, one recommended next step, and any material unknown. Prioritise concrete demand, a recent reply or referral, verified usage and a reachable appropriate person. Potential annual value helps prioritise; seats alone do not prove usage or willingness to pay.

| Direction | Use when | First useful next step |
|---|---|---|
| Conversion | There is an actual need and a plausible purchase route | Clarify one buying condition or offer a forwardable Full quote |
| Retention | Recent installation/use, limited paid value, or experience is uncertain | Ask the main user about their workflow and experience |
| Win-back | Explicit unmet need, cancellation or verified uninstall | Understand the gap and whether a relevant fix merits another try |
| Pause | No reciprocal contact, explicit delay/decline, or our promised feature is unfinished | Record a concrete resume condition; prioritise other customers |

A Full trial approaching expiry is an observation, not urgency or proof of failed conversion. Verify billing/renewal evidence and actual blockers before proposing contact. A payment, a commercial license, a support extension and a communication reply are different facts.

Reconsider paused customers only when a subsequent authorised run finds the recorded condition satisfied; record why. This skill does not create background monitoring.

## Prepare and perform the next step

Apply the contact policy. Use a short natural message with one easy reply, verified product name and relevant context. Draft when drafting is requested. If the user already authorised the actual send/schedule/grant or record update, complete it within that scope without another confirmation. Otherwise prepare a concrete reviewable result before asking for any necessary authorisation.

Before sending, re-check recipients, latest replies, equivalent drafts/scheduled messages and the final content against scope. For scheduling, use the recipient's verified timezone, explicit calendar date and daylight-saving rules; verify what the mail system actually scheduled. A spreadsheet date is not a scheduled email.

Verify the result in the original system. An attempted or ambiguous send is **待核验**, not **已发送**; inspect before retrying to prevent duplicates. Then append one activity record and update the opportunity summary. Never silently roll back an external action because a tracker write failed: report the discrepancy and reconcile from evidence.

## Storage

Use [record contract](references/records.md). Locate the selected storage adapter in `private/operations/customer-followup-tracker.md`. Keep real customer data and investigation archives in `private/`. Do not put tracker IDs, contacts or customer examples in public skill files.

If there is no storage connection, finish the investigation/draft and prepare an exact pending record privately; clearly distinguish it from a saved update. Do not claim the tracker changed until re-read verification succeeds.
