#!/usr/bin/env node
// Welcome-email sender CLI for the lifecycle CRM
// (functions/migrations/0024_add_lifecycle_crm.sql: lifecycle_contact /
// lifecycle_touchpoint). Sends the 'welcome' step to every due contact --
// see ./senderCore.mjs's header for the full adapter/portability story and
// ./ingest-licenses.mjs for the sibling CLI this one is modeled on. This
// file keeps only what's genuinely Node/CLI-specific: argv parsing, template
// loading from disk, the dry-run file-writing ESP adapter, the live-send
// double gate, and the node:sqlite driver.
//
// Usage:
//   node scripts/lifecycle/send-welcome.mjs --db <sqlite-path> --dry-run <outdir>
//   node scripts/lifecycle/send-welcome.mjs --db <sqlite-path> --live --yes
//
//   --db <path>       Required. Path to a D1-shaped sqlite file (the local
//                      miniflare D1 file, or a temp file in tests).
//   --dry-run <dir>    Render every due contact's email to
//                      <dir>/<app>-<n>.html instead of sending it. Mutually
//                      exclusive with --live.
//   --live             Actually send via Resend. Requires BOTH
//                      RESEND_API_KEY in the environment AND --yes on the
//                      command line -- a double gate, deliberately, because
//                      this path reaches real customer inboxes and neither
//                      gate alone is a strong enough guard against an
//                      accidental invocation (a leaked/committed key with no
//                      --yes, or a --yes typed out of habit with no key set).
//   --yes              Required alongside --live (see above). No effect with
//                      --dry-run.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNodeSqliteAdapter } from './ingestCore.mjs';
import { resendAdapter, selectDueCore, sendWelcomeCore, SUBJECTS } from './senderCore.mjs';

// node:sqlite is still experimental in Node 22 -- loaded via createRequire to
// match the pattern already established in ingest-licenses.mjs.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

export { resendAdapter, selectDueCore, sendWelcomeCore, SUBJECTS };

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(SCRIPT_DIR, 'templates');
const TEMPLATE_APPS = ['lite', 'full', 'diagramly', 'asyncapi'];

// ---------------------------------------------------------------------------
// Templates (real filesystem -- Node-only)
// ---------------------------------------------------------------------------

// Loads every per-app template from ./templates/welcome-<app>.html, relative
// to THIS FILE (not process.cwd()) so the CLI works the same regardless of
// the invoking shell's working directory.
export function loadTemplates(templatesDir = TEMPLATES_DIR, apps = TEMPLATE_APPS) {
  const templates = {};
  for (const app of apps) {
    const filePath = path.join(templatesDir, `welcome-${app}.html`);
    templates[app] = readFileSync(filePath, 'utf8');
  }
  return templates;
}

// ---------------------------------------------------------------------------
// Dry-run ESP adapter (real filesystem -- Node-only, so it lives here rather
// than in senderCore.mjs; see that file's header for why).
// ---------------------------------------------------------------------------

// Writes each rendered email to <outDir>/<app>-<n>.html (per-app counter,
// 1-indexed) instead of sending it, and returns a fake id so
// sendWelcomeCore's success path (touchpoint meta.esp_id, step advance,
// trackEvent) runs exactly as it would against a real ESP. Creates outDir
// (recursive) up front so a fresh directory doesn't need a separate mkdir at
// the call site.
export function dryRunAdapter(outDir) {
  mkdirSync(outDir, { recursive: true });
  const counters = new Map();
  return {
    async send({ to, subject, html, app }) {
      const n = (counters.get(app) ?? 0) + 1;
      counters.set(app, n);
      const filePath = path.join(outDir, `${app}-${n}.html`);
      writeFileSync(filePath, html);
      console.log(`[send-welcome] DRY RUN wrote ${filePath} (to=${to}, subject="${subject}")`);
      return { id: `dry-run-${app}-${n}` };
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { db: null, dryRunDir: null, live: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--dry-run') args.dryRunDir = argv[++i];
    else if (a === '--live') args.live = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/lifecycle/send-welcome.mjs --db <sqlite-path> --dry-run <outdir>',
      '  node scripts/lifecycle/send-welcome.mjs --db <sqlite-path> --live --yes   (requires RESEND_API_KEY)',
    ].join('\n'),
  );
}

export function resolveEsp(args, env = process.env) {
  if (args.live) {
    if (!env.RESEND_API_KEY) {
      throw new Error(
        '--live requires RESEND_API_KEY to be set in the environment. Refusing to send with no key ' +
          '(this reaches real customer inboxes -- see the module header for why this is a double gate).',
      );
    }
    if (!args.yes) {
      throw new Error(
        '--live requires --yes as an explicit second confirmation. Refusing to send without it ' +
          '(this reaches real customer inboxes -- a key being set is not, by itself, consent to send).',
      );
    }
    return resendAdapter(env.RESEND_API_KEY);
  }

  if (!args.dryRunDir) {
    throw new Error('Either --dry-run <outdir> or --live --yes is required.');
  }
  return dryRunAdapter(args.dryRunDir);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.db || (!args.dryRunDir && !args.live)) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }
  if (args.dryRunDir && args.live) {
    console.error('[send-welcome] FAILED: --dry-run and --live are mutually exclusive.');
    process.exit(1);
  }
  if (!existsSync(args.db)) {
    console.error(`[send-welcome] FAILED: --db path does not exist: ${args.db}`);
    process.exit(1);
  }

  const esp = resolveEsp(args);
  const templates = loadTemplates();

  const db = new DatabaseSync(args.db);
  const adapter = createNodeSqliteAdapter(db);
  const now = new Date().toISOString();

  const dueCount = (await selectDueCore(adapter, now)).length;
  console.log(
    `[send-welcome] mode: ${args.live ? 'LIVE (Resend)' : `DRY RUN -> ${args.dryRunDir}`}; ${dueCount} contact(s) due for 'welcome' at ${now}`,
  );

  const summary = await sendWelcomeCore(adapter, { esp, templates, now, subjectMap: SUBJECTS });

  console.log(`[send-welcome] this run: due=${summary.due} sent=${summary.sent} failed=${summary.failed}`);
  console.log('[send-welcome] this run, per app:');
  for (const [app, counts] of Object.entries(summary.byApp).sort()) {
    console.log(`  ${app}: sent=${counts.sent} failed=${counts.failed}`);
  }

  db.close();
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) {
  main().catch((err) => {
    console.error('[send-welcome] FAILED:', err.message);
    process.exit(1);
  });
}
