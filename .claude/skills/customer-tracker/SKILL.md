---
name: customer-tracker
description: >-
  Update the 客户转化管理 customer tracker from verified evidence and decisions. Use for
  opportunity summaries, activity-log entries, status-only refreshes, and spreadsheet structure
  edits. This skill maintains the workbook; it does not investigate customers or decide sales actions.
---

# Customer tracker maintenance

Maintain the existing 客户转化管理 spreadsheet using verified facts and decisions supplied by
`customer-followup` or another authorized source. This skill owns workbook edits only; it does not
own source research, customer interpretation, sales decisions, or communications.

Use canonical field meanings from [customer-followup records](../customer-followup/references/records.md)
and [customer-data evidence rules](../customer-data/evidence.md). The private workbook adapter
[`private/operations/customer-followup-tracker.md`](../../../private/operations/customer-followup-tracker.md)
owns the live workbook and tab IDs, current headers, column mapping, timezone, and workbook-specific
conventions. Read it before touching the spreadsheet; do not copy its private identifiers into
public skill material.

## Scope

- **Fact refresh:** update verified opportunity summaries and append dated activity-log records.
- **Status-only refresh:** reconcile current stage, blocker, and obsolete next-action text against
  supplied verified facts that satisfy canonical record rules. Do not invent a new outreach plan.
- **Structure edit:** change headers, columns, formulas, validation, or layout only when requested.
  Treat it as a workbook-wide change and verify shifted references and structure.

Do not send or schedule customer communications, grant licenses, or make sales decisions. Reconcile
stage, blocker, and obsolete next-action text when supplied verified facts satisfy the canonical
record rules; correcting stale tracker status does not require a new human decision. Preserve the
user's pause/observe scope and keep it separate from factual purchase or payment status. If evidence conflicts or is
insufficient, resolve that with the caller. If a needed fact is missing, return the specific evidence
request to `customer-followup`; do not launch a full investigation from this skill.

## Prepare the change

1. Read the private adapter and current workbook. Match opportunities by stable `OPP-...` identity,
   not row position or customer name alone. Check for duplicate IDs, missing IDs, and sheet errors;
   isolate affected rows and resolve mapping before writing.
2. Reuse verified evidence and its original source timestamp. Missing data is not zero and is not
   proof of non-payment. If the source is incomplete or unavailable, keep the last dated fact marked
   stale, or mark it unknown; never apply a fresh verification date to an unavailable source.
3. Build a minimal patch keyed by opportunity ID and current header, with old value, new value, and
   evidence/source. Take a pre-write snapshot. Before writing, re-read affected cells for concurrent
   edits and reconcile any differences; do not overwrite newer work.
4. For activity entries, preserve source IDs, dates, and distinctions between observed facts and
   decisions. Check existing `ACT-...` IDs and source/action identity so retries cannot append the
   same activity twice. For a new opportunity, deduplicate by verified site + product + goal, allocate
   unused stable `OPP-...` and `ACT-...` IDs from current records/history, then extend native-table,
   validation, and formula ranges only as needed. Never hardcode the next ID or create a duplicate row.
   Add the activity record before adding a summary link that points to it.

## Field-specific handling

- Record whole-site annual potential from the supplied verified product, licensed seats, pricing
  date, and calculation, using the adapter's basis (currently cumulative tiered monthly price × 12).
  It is a potential estimate, not an annual quote, payment, or receipt. The
  separate $299 space plan is not this whole-site calculation. Label unknown seats and estimates
  explicitly; return missing inputs to `customer-followup` rather than doing new pricing research.
- For the current seven-day usage column, state the supplied seven complete days, timezone, product
  scope, viewers, views, creates, and updates. Other requested windows must be labelled explicitly.
  Use supplied upstream cross-version viewer deduplication; do not recalculate or issue
  new queries here. Distinguish a successful product-scoped query with zero events from a query not
  performed, unavailable, or incomparable. Mini Sites has distinct telemetry.
- Preserve purchase evidence separately from payment/settlement status. Do not infer “not purchased”
  from an Open payment status or turn an unverified amount into received revenue.

## Write and recover

For actions known to be supported by the CLI (for example, `gws`), **always use the CLI** for operational
reads and writes. Verification is a separate exception: CLI or UI may verify the result, even when
CLI supports the corresponding read. If capability is uncertain, inspect command help/schema first. Missing tools,
authentication failures, expired credentials, insufficient OAuth scopes, and runtime errors are not
evidence that the CLI lacks a capability. Report the specific error without exposing credentials
and stop the affected execution action; do not bypass the problem with UI or a connector/API.
UI may still verify already-performed actions, but must not conceal the CLI failure.

For execution, use UI **only for a capability the CLI cannot perform**. UI is also permitted for
verification, including saved cell values, formatting, and rendered layout. A connector/API may serve a genuinely unsupported capability, but
must not replace CLI for supported actions. A prepared TSV, successful command, completed click/paste,
or local workbook edit alone does not prove the live sheet was saved. Follow the private adapter and
use one writer for a shared workbook/session; workers may prepare and verify patch data.

Prefer cell-level edits. Do not replace a full sheet for a small change. Preserve formulas, data
validation, links, number/date formats, native tables, conditional formatting (including paused-row
gray and review formulas), and frozen panes. After a column move or insertion, check formula
references by their mapped cells; never copy raw values over formula columns. Check visual widths,
wrapping, dates, and dropdowns after structural edits.

After a write, read back the affected rows. For batches or structural edits, compare expected and
untouched values, formula results/errors, unique opportunity and activity IDs, and relevant
structure. CLI snapshots and UI readback may provide verification evidence; choose coverage sufficient
for the change, rather than treating one visible cell as proof of a whole batch. Connector/API evidence
is allowed for capabilities the CLI lacks. A separate workbook export is not required when the
snapshot contains equivalent values, formulas, and metadata. Structural layout changes still require
visual inspection, which may use UI. Compare semantic style
properties, not XLSX style IDs. If a write is partial or uncertain, re-read the live state and repair
only missing/wrong cells; never blindly replay the patch or append duplicate activities. A failed
tracker write is not a reason to undo an independently sent email, scheduled message, or license grant.

Report whether the change is **saved and verified**, **partially saved**, or **prepared only**. Name
any remaining mismatch or evidence gap. If the workbook layout actually changed and was verified,
update the private adapter; otherwise leave it alone.
