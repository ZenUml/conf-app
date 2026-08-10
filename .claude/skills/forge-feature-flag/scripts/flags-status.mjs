#!/usr/bin/env node
/**
 * flags-status — report Forge feature-flag state per app variant, headlessly.
 *
 * Why this exists: the Developer Console UI is the only place that LISTS flags,
 * and driving it with Playwright is slow and flaky. This talks to the public
 * GraphQL gateway with an API token instead.
 *
 *   set -a; source .env.forge.local; set +a
 *   node .claude/skills/forge-feature-flag/scripts/flags-status.mjs
 *   node .../flags-status.mjs --app lite --json
 *   node .../flags-status.mjs --keys renderer-prefetch,ai-title-enabled
 *   node .../flags-status.mjs --include-branches      # widen key discovery
 *
 * HOW IT WORKS (and the one thing it cannot do)
 *
 * `ecosystem.forgeAuditLogs(appId).featureFlagsAuditLogs(input)` requires a
 * `flagId` — there is NO enumeration query on the public schema. So this tool
 * takes a candidate key list (discovered from source, or given via --keys) and
 * asks the audit log about each one. Existence, last action and change history
 * are folded from that log; environments are parsed out of the log's
 * human-readable `details` strings (the typed `changes` object is always null —
 * see the NOTE above AUDIT_QUERY). Rule percentages appear only in `details`
 * lines when they changed, so treat the Console as authoritative for exact
 * current rules.
 *
 * CONSEQUENCE — it cannot find a flag that exists in the Console but is
 * referenced nowhere in the repo. Those orphans (e.g. `ai-chat-enabled`, whose
 * code only ever lived on an unmerged branch) are exactly what a slot-pressure
 * audit is hunting, so use --include-branches to also scan remote branch heads,
 * and fall back to the Console UI when you need a definitive inventory.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const APPS = {
  lite: '8ad26115-211f-4216-971b-0540f606303d',
  full: 'd9e4002b-120b-426b-834b-402a4a5adce7',
  diagramly: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
  asyncapi: '49017727-af19-4ab6-8d5a-7d28108936b6',
};

const GRAPHQL = 'https://api.atlassian.com/graphql';
const FLAG_LITERAL = /checkFlag\(\s*['"]([a-z0-9][a-z0-9-]*)['"]/g;
const FLAG_CONST = /const\s+[A-Z_]*FLAG[A-Z_0-9]*\s*=\s*['"]([a-z0-9][a-z0-9-]*)['"]/g;

function parseArgs(argv) {
  const out = { apps: Object.keys(APPS), keys: null, json: false, branches: false, limit: 6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--history') out.history = true;
    else if (a === '--include-branches') out.branches = true;
    else if (a === '--app') out.apps = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--keys') out.keys = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function loadEnvFile() {
  // Convenience only — `set -a; source .env.forge.local` is the documented path.
  if (process.env.FORGE_EMAIL && process.env.FORGE_API_TOKEN) return;
  if (!existsSync('.env.forge.local')) return;
  for (const line of readFileSync('.env.forge.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function discoverKeys({ branches }) {
  const found = new Map(); // key -> Set(where)
  const add = (k, where) => {
    if (!found.has(k)) found.set(k, new Set());
    found.get(k).add(where);
  };
  const scan = (text, where) => {
    for (const re of [FLAG_LITERAL, FLAG_CONST]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) add(m[1], where);
    }
  };

  scan(git(['grep', '-hE', "checkFlag\\(|const [A-Z_]*FLAG", '--', 'src/']), 'HEAD');

  if (branches) {
    const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'])
      .split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((r) => !r.endsWith('/HEAD'));
    for (const ref of refs) {
      const text = git(['grep', '-hE', "checkFlag\\(|const [A-Z_]*FLAG", ref, '--', 'src/']);
      if (text) scan(text, ref.replace('refs/remotes/', ''));
    }
  }
  return found;
}

async function gql(query, variables, attempts = 3) {
  // Retry transient transport failures. Without this, a dropped connection
  // renders as "ERROR fetch failed", which reads like "unknown flag state" —
  // dangerous when the answer decides whether a flag is safe to delete.
  const auth = Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64');
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    try {
      const res = await fetch(GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const body = await res.json();
      if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
      return body.data;
    } catch (e) {
      lastErr = e;
      // A GraphQL-level error is deterministic — don't burn retries on it.
      if (!/fetch failed|network|ECONN|ETIMEDOUT|socket/i.test(String(e.message))) throw e;
    }
  }
  throw lastErr;
}

// NOTE: the typed `changes { rules { new { env passPercentage } } }` selection is
// accepted by the schema but comes back NULL on every event (checked against a
// flag edited minutes earlier). The populated field is `details` — a list of
// human-readable strings like:
//   "'Everyone' has been deleted"
//   "'Rule 2' applied environments changed from development, staging to development, staging, production"
// So current envs are recovered by reading the newest environments line, not
// from a structured payload. Don't "fix" this back to `changes`.
const AUDIT_QUERY = `query FlagAudit($appId: ID!, $flagId: ID!) {
  ecosystem { forgeAuditLogs(appId: $appId) {
    featureFlagsAuditLogs(input: {flagId: $flagId, first: 50}) {
      __typename
      ... on QueryError { message }
      ... on ForgeAuditLogsFeatureFlagsConnection {
        nodes { timestamp actorId action details }
      }
    }
  } }
}`;

const ENV_LINE = /applied environments changed from .* to ([a-z, ]+)/i;
const ENV_SET = /applied environments (?:set to|are) ([a-z, ]+)/i;

/** Fold the change log (newest-first) into the flag's current shape. */
function foldState(nodes) {
  if (!nodes?.length) return { exists: false };
  const newest = nodes[0];
  if (newest.action === 'FEATURE_FLAG_DELETED') {
    return { exists: false, deletedAt: newest.timestamp, lastAction: newest.action, history: nodes };
  }
  const state = {
    exists: true,
    lastAction: newest.action,
    lastChangedAt: newest.timestamp,
    createdAt: nodes.find((n) => n.action === 'FEATURE_FLAG_CREATED')?.timestamp ?? null,
    events: nodes.length,
    latestDetail: (newest.details || [])[0] ?? '',
    history: nodes,
  };
  // Newest wins: first environments line walking newest→oldest is the live one.
  for (const n of nodes) {
    for (const line of n.details || []) {
      const m = line.match(ENV_LINE) || line.match(ENV_SET);
      if (m && !state.envs) state.envs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (state.envs) break;
  }
  return state;
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }
  loadEnvFile();
  if (!process.env.FORGE_EMAIL || !process.env.FORGE_API_TOKEN) {
    console.error('FORGE_EMAIL / FORGE_API_TOKEN missing. Run: set -a; source .env.forge.local; set +a');
    process.exit(2);
  }
  for (const a of opts.apps) {
    if (!APPS[a]) { console.error(`unknown app "${a}" — known: ${Object.keys(APPS).join(', ')}`); process.exit(2); }
  }

  const discovered = opts.keys ? new Map(opts.keys.map((k) => [k, new Set(['--keys'])])) : discoverKeys(opts);
  const keys = [...discovered.keys()].sort();
  if (!keys.length) {
    console.error('no flag keys found. Pass --keys a,b or run from the repo root.');
    process.exit(2);
  }

  const pairs = opts.apps.flatMap((app) => keys.map((key) => ({ app, key })));
  const rows = await mapLimit(pairs, opts.limit, async ({ app, key }) => {
    try {
      const data = await gql(AUDIT_QUERY, { appId: APPS[app], flagId: key });
      const r = data.ecosystem.forgeAuditLogs.featureFlagsAuditLogs;
      if (r.__typename !== 'ForgeAuditLogsFeatureFlagsConnection') {
        return { app, key, error: r.message || r.__typename };
      }
      return { app, key, ...foldState(r.nodes) };
    } catch (e) {
      return { app, key, error: String(e.message).slice(0, 120) };
    }
  });

  if (opts.json) {
    console.log(JSON.stringify({ keys: [...discovered].map(([k, v]) => ({ key: k, seenIn: [...v] })), rows }, null, 2));
    return;
  }

  if (opts.history) {
    for (const r of rows.filter((x) => x.history?.length)) {
      console.log(`\n## ${r.key} @ ${r.app}`);
      for (const n of r.history) {
        console.log(`  ${n.timestamp}  ${n.action.replace('FEATURE_FLAG_', '')}`);
        for (const d of n.details || []) console.log(`      - ${d}`);
      }
    }
    return;
  }

  const pad = (s, n) => String(s ?? '').padEnd(n);
  console.log(pad('FLAG', 32) + pad('APP', 11) + pad('STATE', 8) + pad('ENVS(from log)', 33) + 'LAST CHANGE');
  console.log('-'.repeat(112));
  for (const r of rows) {
    const state = r.error ? 'ERROR' : r.exists ? 'live' : r.deletedAt ? 'deleted' : 'absent';
    if (state === 'absent') continue; // never created in this app — the common case, don't spam
    const envs = r.error ? r.error.slice(0, 28) : (r.envs || []).join(',') || '(never changed)';
    console.log(pad(r.key, 32) + pad(r.app, 11) + pad(state, 8) + pad(envs, 33) + (r.lastChangedAt || r.deletedAt || ''));
  }
  const absent = rows.filter((r) => !r.error && !r.exists && !r.deletedAt);
  if (absent.length) {
    console.log(`\n(${absent.length} app×flag combinations have no history — flag never created in that app)`);
  }
  console.log('\nCAVEATS');
  console.log('  * No enumeration: featureFlagsAuditLogs requires flagId, so this only reports keys it was');
  console.log('    given. A Console flag referenced nowhere in the repo will NOT appear — try');
  console.log('    --include-branches, else read the Console UI.');
  console.log('  * ENVS is parsed from human-readable audit strings; "(never changed)" means the flag has had');
  console.log('    no environment change since creation, NOT that it targets nothing. Percentages are not in');
  console.log('    the log at all. For a definitive rule/percentage read, open the flag in the Console.');
  console.log('  * Use --history for the full per-flag change log.');
}

main().catch((e) => { console.error(e); process.exit(1); });
