#!/usr/bin/env node
// Add or remove one domain from PAGE_CAPTURE_ALLOWED_DOMAINS_{STG,PROD}.
// Incremental interface — reads the current value, computes before/after,
// never asks the caller to retype the full list. Staging writes execute
// immediately; production writes require --confirm (see toggle_kill_switch.mjs
// for the same two-step pattern).
//
//   node .claude/skills/page-capture/scripts/edit_allowlist.mjs --env staging --action add --domain foo-corp
//   node .claude/skills/page-capture/scripts/edit_allowlist.mjs --env production --action remove --domain economical
//   node .claude/skills/page-capture/scripts/edit_allowlist.mjs --env production --action remove --domain economical --confirm

import { ALLOWLIST_VAR, ghVariableGet, ghVariableSet, splitDomains } from './lib.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env') out.env = argv[++i];
    else if (a === '--action') out.action = argv[++i];
    else if (a === '--domain') out.domain = argv[++i];
    else if (a === '--confirm') out.confirm = true;
  }
  return out;
}

const { env, action, domain, confirm } = parseArgs(process.argv.slice(2));

if (!['staging', 'production'].includes(env)) throw new Error('--env must be staging or production');
if (!['add', 'remove'].includes(action)) throw new Error('--action must be add or remove');
if (!domain) throw new Error('--domain is required');

const varName = ALLOWLIST_VAR[env];
const before = ghVariableGet(varName) ?? '';
const beforeList = splitDomains(before);

let afterList;
if (action === 'add') {
  afterList = beforeList.includes(domain) ? beforeList : [...beforeList, domain];
} else {
  afterList = beforeList.filter((d) => d !== domain);
}
const after = afterList.join(',');
const changed = after !== before;

const result = { env, varName, action, domain, before, requestedAfter: after, changed };

if (!changed) {
  process.stdout.write(JSON.stringify({ ...result, executed: false, note: 'no-op: domain already in requested state' }, null, 2) + '\n');
} else if (env === 'production' && !confirm) {
  process.stdout.write(JSON.stringify({ ...result, executed: false, needsConfirmation: true }, null, 2) + '\n');
} else {
  ghVariableSet(varName, after);
  process.stdout.write(JSON.stringify({ ...result, after, executed: true }, null, 2) + '\n');
}
