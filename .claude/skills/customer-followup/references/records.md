# Portable customer record contract

The storage adapter maps these meanings to current header names, never fixed column letters or row numbers. Re-read table headers and find the row by stable ID before editing. Fail clearly on missing/duplicate IDs; do not select a customer by display-name resemblance alone.

## Opportunity summary

One opportunity per customer site + product + commercial goal. Related spaces stay in one opportunity unless separate buying processes justify another. Full and Lite usage can be compared, but licenses and events retain variant identity.

- Stable opportunity ID; company/domain and verified site key; product; goal/type.
- Opportunity stage: pending needs, contacted, waiting for customer, confirming buying conditions, procurement, won, declined, paused. Winning/closing requires evidence of the commercial result; a payment alone need not close a technical follow-up.
- License summary, payment status and their evidence date: separate fields. Payment values distinguish not checked, no payment record found, paid, partially paid and refunded. Do not turn unknown into unpaid.
- Current blocker, next action, owner and next review date in a documented timezone.
- Main contact, decision-maker and role evidence (role unknown is valid).
- Potential annual value + currency + estimate/list/quote/contract basis and date. This is not received revenue.
- Evidence links and latest meaningful record reference.
- Pause reason and observable resume condition, or result date and closure reason.

Keep the summary short. Full messages stay in Gmail/tickets, license/transaction records in their source, and longer analyses in private Handbook files. An archive is not a refreshed fact.

## Activity log

Append one row per meaningful actual communication, signal check or decision. Include record date, opportunity ID, contact, channel, factual summary (quotes clearly labelled), action taken, outcome/interpretation, evidence link, owner, record type, action status, execution time/timezone and stable activity ID.

Action states: draft, scheduled, sent, received, cancelled, failed, pending verification, not applicable. Old mixed records may retain "see original record"; do not fabricate exact transitions during migration. Preserve existing IDs; when importing old history mark it explicitly as historical organisation and preserve the evidence date.

## Safe write and verification

1. Inspect current values and latest activity. Preserve unrelated edits, formulas, formats, validation and source links.
2. Match source message/ticket/event identifiers to existing records before appending. A retry must not duplicate a sent event. If two actions are genuinely different, retain both.
3. Append the verified activity, then update only affected summary fields. If an edit was only prepared, leave status as draft/pending and say where it is stored.
4. Re-read saved values, record ID and source link. For structural changes also verify table ranges, validation values, formulas and a screenshot. Flag partial writes for reconciliation; do not announce success for an unsaved tracker update.

Pause and payment do not overwrite communication history. Formulas are presentation aids, not authority for sending, billing or resuming contact. A review date schedules human attention; it creates no automation.

## When Sheets becomes insufficient

Revisit storage when multiple simultaneous buying processes, large contact relationships, frequent concurrent writes or missed/duplicated actions cannot be handled reliably by two tables and source links. Preserve this contract if moving to another CRM; do not embed its APIs into the decision policy.
