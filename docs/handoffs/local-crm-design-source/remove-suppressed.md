# Remove `suppressed` from the lifecycle CRM

`lifecycle_contact.suppressed` has no requirement behind it. There is no lifecycle-CRM
spec in `docs/superpowers/specs/`, and nothing in `docs/` states an unsubscribe or
opt-out requirement. The only justification is migration 0024's own comment.

The comment says it is the unsubscribe/opt-out flag. The code disagrees: the sole
writer of `suppressed = 1` anywhere in the repo is `upsertContactCore`'s insert path
(`bootstrap ? 1 : 0`). `UPDATE_CONTACT` never touches it, the lapse pass never touches
it, and no unsubscribe signal is ingested. Migration 0025 later adds `unsubscribed_at`
as a separate column, which concedes the point.

## Behaviour that must survive the removal

The one thing `suppressed` actually does is keep the bootstrapped backlog out of the
drip: `SELECT_DUE` requires `suppressed = 0`, so the 1,498 historical contacts can
never be welcomed retroactively. Deleting the column without a replacement turns the
next non-dry run into a mass send to the entire existing customer base.

Replacement, using columns migration 0025 already adds — no new schema:

    welcome_state = 'blocked'
    block_reason  = 'backlog'

Set on insert during a `--bootstrap` run, and read by the sender's due query.

## Changes, file by file

### functions/migrations/

Do not edit 0024 or 0025 in place — both have applied specs and passing tests.
Add a new forward migration:

    0026_drop_lifecycle_suppressed.sql
      - rebuild lifecycle_contact without the `suppressed` column
        (SQLite/D1 has no DROP COLUMN on a table with a partial index)
      - carry every existing suppressed=1 row over as
        welcome_state='blocked', block_reason='backlog'
      - recreate idx_lifecycle_contact_step_due without the
        `WHERE suppressed = 0` clause
      - keep the D1 migration numbering contiguous

Then:

- `0024_add_lifecycle_crm.sql` — the header comment sentence describing
  `suppressed` as the unsubscribe/opt-out flag is now false. Amend the comment only
  if you are also amending the file; otherwise leave it and let 0026 supersede it.
- `0025_add_lifecycle_auto_welcome.sql` — header comment mentions
  "nothing here rewrites step/step_due_at/suppressed". Drop the third name.
- `0024.spec.ts` — remove `'suppressed'` from the expected column list (line 33),
  from the INSERT column list (line 69) and fixture (line 95), and from the
  defaults assertion (lines 130–138).
- `0025.spec.ts` — remove `'suppressed'` from the expected column list (line 30).

### scripts/lifecycle/

- `ingestCore.mjs`
  - `SQL.INSERT_CONTACT` — drop the column and its bind placeholder.
  - `SQL.SELECT_TENANTS` — drop `suppressed` from the select list.
  - `upsertContactCore` / `upsertContactAsyncCore` — drop the `suppressed` bind;
    write `welcome_state`/`block_reason` from the `bootstrap` flag instead.
  - `buildSnapshotCore` / `buildSnapshotAsyncCore` — remove `suppressed: r.suppressed`
    from the tenant object (both twins). Decide whether the snapshot should now
    expose `welcome_state`; the Ops Console reads this shape.
  - Header/inline comments at the `upsertContactCore` contract (~267–269) and the
    lapse-pass invariant (~328) name the column; rewrite both.
- `senderCore.mjs`
  - `SQL.SELECT_DUE` — replace `AND suppressed = 0` with the `welcome_state`
    condition. This is the load-bearing line; get it right first.
  - `selectDueCore`'s doc comment (~137–138) explains the bootstrap-backlog
    interaction in terms of `suppressed`; rewrite against the new column.
- `ingest-licenses.mjs`
  - `--bootstrap` help text (~16, ~20) and the mode log line (~206).
  - The per-app summary query (~221) selects `SUM(suppressed) as suppressed_total`
    and prints it (~226) — change to count blocked-as-backlog rows.
  - Module header (~9) lists `suppressed` among columns never reset.
- `ingest.spec.ts` — fixtures at 163 and 285; the bootstrap test at 212–230 (its
  name, both assertions, and the trailing comments); the invariant test at
  393–400, "lapsing never touches the suppressed flag", which should be rewritten
  to assert lapsing leaves `welcome_state`/`block_reason` alone.
- `senderCore.spec.ts` — the fixture type at 61, default at 74, INSERT list at 82
  and bind at 92; the exclusion test at 147–148 and the inclusion test at 157.

### Not in scope

These match on the word but are unrelated features — leave them alone:
`functions/agent-link/parseDsl.ts` (mermaid `suppressErrors`),
`functions/api/space-status.ts` (paid-rail paywall suppression),
`functions/service/forgeUserBehavior.ts` (`suppressNotifications`),
plus the paywall, byline, CSAT and vue-compat docs.

## Order

1. Land 0026 and its spec.
2. Change `SELECT_DUE`, then `upsertContactCore` — the two places behaviour lives.
3. Sweep the remaining reads, the CLI output, and the comments.
4. Update the specs listed above; they are the only guard on the backlog invariant.
5. Run a `--dry-run` against a bootstrapped fixture DB and confirm `due` is still
   the newcomer count, not the whole table. That assertion is the point of the change.
