#!/usr/bin/env node
/** Local operator client for the authenticated Fullscreen recovery support APIs. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set(['customer_replied', 'next_step_agreed', 'closed']);
const READS = new Set(['list', 'show', 'preview', 'status']);
const MUTATIONS = new Set(['send', 'retry', 'mark_unknown', 'extend', 'outcome']);
const MAIL = new Set(['preview', 'status', 'send', 'retry', 'mark_unknown']);

export const usage = `Fullscreen recovery support CLI

Set FULLSCREEN_RECOVERY_API_URL and FULLSCREEN_RECOVERY_OPERATOR_TOKEN in the local environment.
Read:     list | show --id UUID | preview --id UUID [--time-zone UTC] | status --id UUID
Mutation: send | retry | mark_unknown | extend | outcome --input FILE [--confirm]
Mutations are dry runs until --confirm is present. The input file contains the exact JSON body.
A send body must contain the previewHash returned by preview and the same timeZone.
`;

export function allowedApiOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid FULLSCREEN_RECOVERY_API_URL'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('API URL must be an origin without credentials, path, query, or fragment');
  const production = new Set(['conf-lite.zenuml.com', 'conf-stg-lite.zenuml.com', 'zenapi.zenuml.com']);
  if (production.has(url.hostname) && url.protocol === 'https:' && !url.port) return url.origin;
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && (url.protocol === 'http:' || url.protocol === 'https:')) return url.origin;
  throw new Error('API URL is outside the approved Fullscreen recovery backends');
}

function options(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === 'help' || !command) return { command: 'help' };
  if (!READS.has(command) && !MUTATIONS.has(command)) throw new Error('Unknown command');
  const parsed = { command };
  const valued = new Set(['--id', '--input', '--time-zone']);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--confirm') {
      if (parsed.confirm) throw new Error('Duplicate --confirm');
      parsed.confirm = true;
    } else if (valued.has(flag)) {
      if (parsed[flag]) throw new Error(`Duplicate ${flag}`);
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      parsed[flag] = value;
    } else throw new Error(`Unexpected argument: ${flag}`);
  }
  if (READS.has(command)) {
    if (parsed.confirm || parsed['--input']) throw new Error('Read commands do not use --confirm or --input');
    if (command !== 'list' && !UUID.test(parsed['--id'] ?? '')) throw new Error('A valid --id UUID is required');
    if (command === 'list' && parsed['--id']) throw new Error('list does not accept --id');
    if (command !== 'preview' && parsed['--time-zone']) throw new Error('--time-zone applies only to preview');
  } else if (!parsed['--input'] || parsed['--id'] || parsed['--time-zone']) {
    throw new Error('Mutation commands require --input FILE and no --id or --time-zone');
  }
  return parsed;
}

function exactKeys(body, keys) {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Input body fields do not match this command');
}
export function validateMutation(command, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Input file must contain a JSON object');
  if (body.action !== command || !UUID.test(body.requestId ?? ''))
    throw new Error('Input action or requestId is invalid');
  if (command === 'send') {
    exactKeys(body, ['action', 'requestId', 'previewHash', 'timeZone']);
    if (!HASH.test(body.previewHash) || typeof body.timeZone !== 'string'
      || body.timeZone.length < 1 || body.timeZone.length > 80) throw new Error('send requires previewHash and timeZone');
    try { new Intl.DateTimeFormat('en', { timeZone: body.timeZone }); }
    catch { throw new Error('Invalid timeZone'); }
  } else if (command === 'retry' || command === 'mark_unknown') {
    exactKeys(body, ['action', 'requestId']);
  } else {
    exactKeys(body, command === 'extend'
      ? ['action', 'requestId', 'commandId', 'reason']
      : ['action', 'requestId', 'commandId', 'reason', 'supportOutcome']);
    if (!UUID.test(body.commandId ?? '') || typeof body.reason !== 'string'
      || !body.reason.trim() || body.reason.length > 2000) throw new Error('commandId UUID and reason are required');
    if (command === 'outcome' && !OUTCOMES.has(body.supportOutcome)) throw new Error('Invalid supportOutcome');
  }
  return body;
}

/** Dependencies are injectable so tests never contact a backend or mail provider. */
export async function runSupportCli(argv, {
  env = process.env, fetchImpl = fetch, readFile = readFileSync,
  output = (line) => process.stdout.write(`${line}\n`),
  error = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  try {
    const opts = options(argv);
    if (opts.command === 'help') { output(usage.trimEnd()); return 0; }
    const origin = allowedApiOrigin(env.FULLSCREEN_RECOVERY_API_URL ?? '');
    const token = env.FULLSCREEN_RECOVERY_OPERATOR_TOKEN;
    if (typeof token !== 'string' || !token) throw new Error('FULLSCREEN_RECOVERY_OPERATOR_TOKEN is required');
    const mutation = MUTATIONS.has(opts.command);
    let body;
    if (mutation) {
      let file;
      try { file = readFile(opts['--input'], 'utf8'); }
      catch { throw new Error('Cannot read input file'); }
      if (file.length > 64_000) throw new Error('Input file is too large');
      try { body = validateMutation(opts.command, JSON.parse(file)); }
      catch (cause) { throw new Error(cause instanceof SyntaxError ? 'Input file is not valid JSON' : cause.message); }
      if (!opts.confirm) {
        output(JSON.stringify({ dryRun: true, action: body.action, requestId: body.requestId,
          commandId: body.commandId ?? undefined,
          requires: body.action === 'send' ? 'confirmed_preview_hash' : undefined }, null, 2));
        return 0;
      }
    }
    const path = MAIL.has(opts.command)
      ? '/api/support/fullscreen-recovery-mail' : '/api/support/fullscreen-recovery';
    const url = new URL(path, origin);
    if (opts.command === 'show') url.searchParams.set('id', opts['--id']);
    if (opts.command === 'preview' || opts.command === 'status') {
      url.searchParams.set('requestId', opts['--id']);
      if (opts.command === 'status') url.searchParams.set('view', 'status');
      else url.searchParams.set('timeZone', opts['--time-zone'] ?? 'UTC');
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: mutation ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
        ...(mutation ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
      });
    } catch { throw new Error('Backend request failed'); }
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error(`Backend returned non-JSON status ${response.status}`);
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(`Backend returned invalid JSON status ${response.status}`); }
    if (!response.ok) {
      const code = typeof payload?.error === 'string' ? payload.error : 'unknown_error';
      throw new Error(`Backend status ${response.status}: ${code}`);
    }
    output(JSON.stringify(payload, null, 2));
    return 0;
  } catch (cause) {
    error(cause instanceof Error ? cause.message : 'Unknown CLI error');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSupportCli(process.argv.slice(2));
}
