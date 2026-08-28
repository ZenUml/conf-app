// Cloudflare Worker cron entry point for the lifecycle CRM ingest. See
// scripts/lifecycle/ingest-licenses.mjs for the original node CLI (run
// manually / by a human today) and scripts/lifecycle/ingestCore.mjs for the
// shared, DB-agnostic core both that script and this Worker are built on —
// read that file's header first; it explains why the D1 path below uses a
// separate *AsyncCore twin of the node:sqlite-driven functions rather than
// literally the same functions.
//
// STATUS 2026-08-28 (T6b): CODE + TESTS ONLY. Not deployed by any CI job
// (see wrangler.toml's header for the full list of gates), and even if
// deployed, `scheduled()` below is a no-op unless
// LIFECYCLE_INGEST_ENABLED="true" is set for that environment.
//
// Snapshot: the node script's --snapshot flag writes an aggregated JSON view
// to the filesystem for the private Ops Console page to read (see
// project_handbook_ops_console). A Worker has no filesystem. Simplest option
// that needed no new D1 table/migration: log a compact one-line summary
// (funnel row count, tenant count, generated_at) instead of persisting the
// full aggregate anywhere. If this Worker path ships for real, the Ops
// Console will need a different data source for it (e.g. an API route
// reading D1 directly) — this log line is a debugging aid, not a
// replacement for that.

import {
  buildSnapshotAsyncCore,
  createD1Adapter,
  fetchExport,
  ingestRowsAsyncCore,
} from '../../../scripts/lifecycle/ingestCore.mjs';

export interface Env {
  DB: D1Database;
  // Set via `wrangler secret put` per environment — never committed. See
  // functions/CLAUDE.md's credential map and wrangler.toml's TODO(morning).
  FORGE_EMAIL?: string;
  FORGE_API_TOKEN?: string;
  // Flag guard — see module header. Must be the literal string "true" to
  // run; anything else (including unset) is a no-op. Defaults to "false" in
  // both [env.stg.vars] and [env.production.vars] in wrangler.toml.
  LIFECYCLE_INGEST_ENABLED?: string;
}

// Injectable for tests only (mirrors fetchExport's own `fetchImpl` param) —
// production callers never pass this, so scheduled() always uses the real
// global fetch.
export interface RunDeps {
  fetchImpl?: typeof fetch;
}

// The actual ingest, factored out of scheduled() so a test can call it
// directly with a fake D1 binding and a fixture-returning fetchImpl without
// going through the Workers runtime's scheduled-event machinery.
export async function runLifecycleIngest(env: Env, now: string = new Date().toISOString(), deps: RunDeps = {}) {
  const email = env.FORGE_EMAIL;
  const token = env.FORGE_API_TOKEN;
  if (!email || !token) {
    throw new Error(
      'runLifecycleIngest: FORGE_EMAIL / FORGE_API_TOKEN are not set on this Worker environment ' +
        '(wrangler secret put per env — see wrangler.toml TODO(morning))',
    );
  }

  const rawRows = await fetchExport({ email, token }, deps.fetchImpl);
  const adapter = createD1Adapter(env.DB);
  const { summary, hostnameByCloudId } = await ingestRowsAsyncCore(adapter, rawRows, { bootstrap: false, now });
  const snapshot = await buildSnapshotAsyncCore(adapter, hostnameByCloudId, { generatedAt: now });

  console.log(
    `[lifecycle-ingest] inserted=${summary.inserted} updated=${summary.updated} lapsed=${summary.lapsed} ` +
      `skipped=${JSON.stringify(summary.skipped)}`,
  );
  console.log(
    `[lifecycle-ingest] snapshot: ${snapshot.funnel.length} funnel rows, ${snapshot.tenants.length} tenants, ` +
      `generated_at=${snapshot.generated_at}`,
  );

  return summary;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.LIFECYCLE_INGEST_ENABLED !== 'true') {
      console.log('[lifecycle-ingest] LIFECYCLE_INGEST_ENABLED is not "true" — skipping (no-op guard)');
      return;
    }

    const now = new Date(controller.scheduledTime).toISOString();
    console.log(`[lifecycle-ingest] cron triggered at ${now}`);
    ctx.waitUntil(
      runLifecycleIngest(env, now).catch((err) => {
        console.error('[lifecycle-ingest] FAILED:', err instanceof Error ? err.message : err);
        throw err;
      }),
    );
  },
};
