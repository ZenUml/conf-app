#!/usr/bin/env node
// Toggle the PAGE_CAPTURE_ENABLED kill switch for one Forge app in one environment.
// Prints JSON; performs no formatting. Staging writes execute immediately.
// Production writes require --confirm (run once without it to see before/after,
// then re-run with --confirm once the diff has been reviewed).
//
//   set -a; source .env.forge.local; set +a
//   node .claude/skills/page-capture/scripts/toggle_kill_switch.mjs --app lite --env staging --value false
//   node .claude/skills/page-capture/scripts/toggle_kill_switch.mjs --app lite --env production --value true
//   node .claude/skills/page-capture/scripts/toggle_kill_switch.mjs --app lite --env production --value true --confirm

import { APPS, forgeVariablesList, forgeVariablesSet } from './lib.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') out.app = argv[++i];
    else if (a === '--env') out.env = argv[++i];
    else if (a === '--value') out.value = argv[++i];
    else if (a === '--confirm') out.confirm = true;
  }
  return out;
}

const { app, env, value, confirm } = parseArgs(process.argv.slice(2));

if (!Object.keys(APPS).includes(app)) {
  throw new Error(`--app must be one of: ${Object.keys(APPS).join(', ')}`);
}
if (!['staging', 'production'].includes(env)) {
  throw new Error('--env must be staging or production');
}
if (!['true', 'false'].includes(value)) {
  throw new Error('--value must be true or false');
}

const before = forgeVariablesList(env, app).find((v) => v.key === 'PAGE_CAPTURE_ENABLED')?.value ?? null;

const result = { app, env, before, requestedAfter: value };

if (env === 'production' && !confirm) {
  process.stdout.write(JSON.stringify({ ...result, executed: false, needsConfirmation: true }, null, 2) + '\n');
} else {
  forgeVariablesSet(env, app, 'PAGE_CAPTURE_ENABLED', value);
  const after = forgeVariablesList(env, app).find((v) => v.key === 'PAGE_CAPTURE_ENABLED')?.value ?? null;
  process.stdout.write(JSON.stringify({ ...result, after, executed: true }, null, 2) + '\n');
}
