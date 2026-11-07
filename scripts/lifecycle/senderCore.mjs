// Shared, portable welcome-email sender core for the lifecycle CRM
// (functions/migrations/0024_add_lifecycle_crm.sql: lifecycle_contact /
// lifecycle_touchpoint). Sibling of ./ingestCore.mjs and follows the exact
// same conventions -- read that file's header first. In particular: this
// module has NO Node-only imports (no node:fs, node:child_process,
// node:sqlite) beyond the global `fetch`, so it can be imported unmodified
// from the Node CLI (./send-welcome.mjs) and, later, a Cloudflare Worker
// running the same send on a schedule against the D1 binding directly (the
// same relationship ingestCore.mjs already has with
// workers/lifecycle-ingest/src/index.ts).
//
// ---------------------------------------------------------------------------
// Why there is only ONE core function here, not sync/async twins
// ---------------------------------------------------------------------------
// ingestCore.mjs needs a sync core AND an async core because node:sqlite's
// DatabaseSync is synchronous and some legacy callers (ingest.spec.ts) call
// `ingestRows(db, rows, opts)` without `await` and destructure its return
// value on the same line -- see that file's header for the full reasoning.
// Nothing here has that constraint: this module is brand new, and its own
// dominant I/O (esp.send(...), whether that's a real network POST or a
// dry-run file write) is ALWAYS asynchronous regardless of which DB adapter
// backs it. So `sendWelcomeCore` is unconditionally `async` and simply
// `await`s every adapter call -- which works transparently against BOTH
// adapter shapes: node:sqlite's `createNodeSqliteAdapter` (ingestCore.mjs)
// returns plain values, and `await somePlainValue` just resolves to that
// value immediately; `createD1Adapter` (also ingestCore.mjs) returns real
// Promises. One function, two adapters, no drift risk -- there is no
// sync/async pair to keep in sync in the first place. Nor does this module
// wrap sends in a DB transaction (unlike ingestRowsCore's BEGIN/COMMIT): each
// due contact's outcome (touchpoint insert + step advance, OR failure note)
// commits independently, matching D1's own no-manual-transactions model and
// keeping one slow/failed ESP call from holding a lock over every other
// contact in the batch.
//
// Adapter interface consumed here is the SAME one ingestCore.mjs defines --
// import `createNodeSqliteAdapter` / `createD1Adapter` from there rather than
// redefining them. This module adds one more DI seam of its own: the `esp`
// (Email Service Provider) adapter, shaped `{ send({from, to, subject, html,
// app}) => Promise<{id?: string}> }` -- see `resendAdapter` (real, portable:
// only touches global fetch) below. `dryRunAdapter` needs node:fs to write
// files, so -- same split as ingestCore.mjs/ingest-licenses.mjs -- it lives
// in ./send-welcome.mjs (the CLI), not here.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Unusable for a real --live send until support@zenuml.com is verified as a
// sending domain at the ESP (Resend) -- fine for --dry-run today. A --live
// attempt before verification fails loudly via resendAdapter's non-2xx
// error, not silently.
export const FROM_ADDRESS = 'ZenUML <support@zenuml.com>';

// Per-app welcome subject lines (2026-08-28 welcome-email design). Diagramly
// deliberately uses a different emoji (👋, not 🎉) than the other three --
// see templates/welcome-diagramly.html's KNOWN GAP comment for the resulting
// mismatch against that template's own in-body H1, which still reads "…🎉"
// because the swap matrix scoped that template's derivation to the wordmark
// and footer only.
export const SUBJECTS = {
  lite: 'Welcome to ZenUML for Confluence 🎉',
  full: 'Welcome to ZenUML for Confluence 🎉',
  diagramly: 'Welcome to Diagramly for Confluence 👋',
  asyncapi: 'Welcome to AsyncAPI for Confluence 🎉',
};

// Injectable analytics hook, called once per SUCCESSFUL send (never on ESP
// failure -- a failed send has nothing to report as "sent"). Shape mirrors
// functions/service/mixpanelService.ts's MixpanelServiceEvent (event /
// properties / distinctId / insertId / time) on purpose: that file already
// has a working, tested import-API path (`mixpanelImportServiceEvents`) for
// exactly this kind of backend-emitted, no-user-identity event, and
// `email_step_sent` / `product_type` / `cloud_id` / `step` are already
// registered for it in src/utils/analytics/catalog.ts + types.ts (T4, this
// same overnight run). This module can't call that function directly --
// it's TypeScript, and this file must stay a plain, dependency-free .mjs so
// a future Worker can import it unmodified (see the module header) -- so the
// wiring is DI, matching the `esp` adapter pattern one seam over.
// TODO(pre-launch): pass a real `trackEvent` from a TS call site that CAN
// import mixpanelService.ts, e.g.
//   trackEvent: (e) => mixpanelImportServiceEvents([e], MIXPANEL_TOKEN)
// Left as a no-op here -- do not invent a new HTTP integration for this
// tonight (see also FROM_ADDRESS's own not-ready-yet note).
export const NOOP_TRACK_EVENT = () => {};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// SQL text shared verbatim between callers -- the single source of truth for
// "what" this module does, same convention as ingestCore.mjs's SQL constant.
const SQL = {
  SELECT_DUE: `SELECT contact_email, app, cloud_id, seat_tier, license_type, step
     FROM lifecycle_contact
    WHERE step = 'welcome' AND suppressed = 0
      AND (step_due_at IS NULL OR step_due_at <= ?)
    ORDER BY app, contact_email`,
  INSERT_TOUCHPOINT: `INSERT INTO lifecycle_touchpoint
      (contact_email, app, kind, step, meta, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  ADVANCE_TO_D3: `UPDATE lifecycle_contact
      SET step = 'd3', step_due_at = ?
    WHERE contact_email = ? AND app = ?`,
};

// ---------------------------------------------------------------------------
// Pure helpers (no DB, no network -- identical in every runtime)
// ---------------------------------------------------------------------------

// Whole-millisecond ISO offset from `nowIso`. Used for step_due_at = now+3d
// on a successful send. Deliberately NOT calendar-day truncated (unlike
// ingestCore.mjs's computeEvalDaysRemaining) -- step_due_at is a due
// TIMESTAMP a scheduler compares with `<=`, not a display countdown, so a
// send at 14:32 becomes due again at 14:32 three days later rather than at
// UTC midnight.
export function addDays(nowIso, days) {
  return new Date(new Date(nowIso).getTime() + days * MS_PER_DAY).toISOString();
}

// Substitutes any `{{key}}` found in `mergeTags`; a tag NOT present in
// `mergeTags` is left untouched (literal `{{key}}` stays in the output).
// sendWelcomeCore below calls this with an empty tag map today, so
// {{unsubscribe_url}} / {{preferences_url}} (and {{asyncapi_docs_url}} on the
// asyncapi template) always render as literal merge-tag text -- see the
// TODO on sendWelcomeCore for why, and check any --dry-run output file to
// see it happening.
export function renderTemplate(templateHtml, mergeTags = {}) {
  return templateHtml.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(mergeTags, key) ? String(mergeTags[key]) : match,
  );
}

// ---------------------------------------------------------------------------
// Core (adapter-driven -- works against createNodeSqliteAdapter's plain
// values AND createD1Adapter's Promises; see module header)
// ---------------------------------------------------------------------------

// Contacts due for the 'welcome' step right now: step='welcome' AND
// suppressed=0 AND (step_due_at IS NULL OR step_due_at<=now). Every
// bootstrap-ingested backlog row is suppressed=1 (see ingestCore.mjs's
// upsertContactCore), so this returns empty until a NEW contact appears via
// a non-bootstrap ingest run -- the backlog can never enter the drip
// retroactively. Exported standalone (not just inlined in sendWelcomeCore) so
// a caller can report "N due" before deciding whether to actually send --
// see send-welcome.mjs's --dry-run summary line.
export async function selectDueCore(adapter, now = new Date().toISOString()) {
  return adapter.all(SQL.SELECT_DUE, [now]);
}

// Sends the 'welcome' step to every due contact and records the outcome.
//   esp        - required. `{ send({from, to, subject, html, app}) =>
//                Promise<{id?: string}> }`. See resendAdapter (this file) and
//                dryRunAdapter (send-welcome.mjs).
//   templates  - required. `{ lite, full, diagramly, asyncapi }` map of
//                already-loaded template HTML strings, keyed by
//                lifecycle_contact.app. A due contact whose app has no entry
//                is treated exactly like an ESP failure (see below) rather
//                than thrown -- one misconfigured app must not abort every
//                other due contact in the same run.
//   now        - ISO timestamp, defaults to wall-clock. Passed through to
//                every touchpoint's created_at and to addDays() for the
//                step_due_at this run computes.
//   subjectMap - defaults to SUBJECTS above.
//   trackEvent - defaults to NOOP_TRACK_EVENT; see that constant's comment.
//
// Per due contact, on SUCCESS: insert one lifecycle_touchpoint
// (kind='email_sent', step='welcome', meta={subject, esp_id}), then advance
// lifecycle_contact to step='d3', step_due_at=now+3d, then fire trackEvent.
// On ESP (or missing-template) FAILURE: insert one lifecycle_touchpoint
// (kind='note', meta={error}), leave step/step_due_at untouched, and
// continue to the next due contact -- deliberately no retry inside this run
// (no retry storm); a failed contact stays 'due' and is simply picked up
// again the next time this function runs.
export async function sendWelcomeCore(
  adapter,
  { esp, templates, now = new Date().toISOString(), subjectMap = SUBJECTS, trackEvent = NOOP_TRACK_EVENT } = {},
) {
  if (!esp || typeof esp.send !== 'function') {
    throw new Error('sendWelcomeCore: an esp adapter with a send(...) method is required');
  }

  const dueRows = await adapter.all(SQL.SELECT_DUE, [now]);
  const summary = { due: dueRows.length, sent: 0, failed: 0, byApp: {} };

  for (const row of dueRows) {
    const app = row.app;
    summary.byApp[app] ??= { sent: 0, failed: 0 };

    const template = templates?.[app];
    if (!template) {
      const meta = JSON.stringify({ error: `no template registered for app "${app}"` });
      await adapter.run(SQL.INSERT_TOUCHPOINT, [row.contact_email, app, 'note', row.step ?? 'welcome', meta, now]);
      summary.failed += 1;
      summary.byApp[app].failed += 1;
      continue;
    }

    const subject = subjectMap[app];
    // TODO(pre-launch): {{unsubscribe_url}} / {{preferences_url}} /
    // {{asyncapi_docs_url}} are ESP-generated, per-recipient merge tags.
    // Nothing supplies real values here yet (empty tag map), so they render
    // as literal `{{...}}` text -- wire them to Resend's own template merge
    // fields (or resolve them here before render) before any --live send.
    const html = renderTemplate(template, {});

    try {
      const result = await esp.send({ from: FROM_ADDRESS, to: row.contact_email, subject, html, app });
      const espId = result?.id ?? null;

      const sentMeta = JSON.stringify({ subject, esp_id: espId });
      await adapter.run(SQL.INSERT_TOUCHPOINT, [row.contact_email, app, 'email_sent', 'welcome', sentMeta, now]);
      await adapter.run(SQL.ADVANCE_TO_D3, [addDays(now, 3), row.contact_email, app]);

      trackEvent({
        event: 'email_step_sent',
        properties: { product_type: app, cloud_id: row.cloud_id ?? null, step: 'welcome' },
        distinctId: row.cloud_id ?? row.contact_email,
        insertId: `${app}:${row.contact_email}:welcome:${now}`,
        time: Math.floor(new Date(now).getTime() / 1000),
      });

      summary.sent += 1;
      summary.byApp[app].sent += 1;
    } catch (err) {
      const errorMeta = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      await adapter.run(SQL.INSERT_TOUCHPOINT, [row.contact_email, app, 'note', row.step ?? 'welcome', errorMeta, now]);
      summary.failed += 1;
      summary.byApp[app].failed += 1;
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// ESP adapters
// ---------------------------------------------------------------------------

// Real Resend send. Portable: only touches global `fetch`, same as
// ingestCore.mjs's fetchExport (see that function's own comment on why that
// makes it Worker-safe too). Throws immediately if no key is given -- fail
// fast at adapter construction, not on the first (or every) send.
export function resendAdapter(apiKey) {
  if (!apiKey) {
    throw new Error(
      'resendAdapter: a Resend API key is required (pass RESEND_API_KEY, never hardcode it). ' +
        'Refusing to construct an adapter that would fail on every send.',
    );
  }
  return {
    async send({ from, to, subject, html }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!res.ok) {
        // Never include apiKey here -- it's the one thing in this module
        // that must never be logged.
        throw new Error(`Resend send failed: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
  };
}
