#!/usr/bin/env node
/**
 * Spot check for PR #1115: a headless MCP tool error that reaches Confluence
 * and fails reports WHERE it failed in Mixpanel (`failure_step`,
 * `upstream_status`), and a non-upstream refusal does not.
 *
 * What it does, against one backend (staging by default):
 *   1. Registers a throwaway OAuth client with a loopback redirect, opens the
 *      authorize URL in your browser, and waits for the callback. You sign in
 *      as yourself — a person, so Atlassian's bot check is not in the way.
 *   2. Calls the MCP endpoint with that token:
 *        A. read_diagram, non-numeric contentId → Confluence 400 → expect a
 *           tool error with code 'upstream'
 *        B. read_diagram, numeric id that does not exist → Confluence 404 →
 *           expect code 'not_found' (control: must carry no failure_step)
 *   3. If MIXPANEL_SA_USER / MIXPANEL_SA_SECRET are set, polls the Mixpanel
 *      export API for this run's `agent_link_mcp_tool_called` events — found by
 *      the run's own oauth_client_id, so other traffic cannot match — and
 *      asserts:
 *        A: reason=upstream, failure_step=diagram_read, upstream_status=400
 *        B: reason=not_found, no failure_step / upstream_status
 *
 * Usage (Node 18+, no dependencies):
 *   node scripts/spot-check-mcp-upstream-analytics.mjs
 *   node scripts/spot-check-mcp-upstream-analytics.mjs --site lite-stg --base https://conf-stg-lite.zenuml.com
 *
 * Your Atlassian account must be able to reach the --site (default lite-stg).
 * Without Mixpanel credentials, step 3 prints the client id to filter on.
 * Exit code: 0 all checks passed, 1 a check failed, 2 setup failed.
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const BASE = (args.base ?? 'https://conf-stg-lite.zenuml.com').replace(/\/$/, '');
const SITE = args.site ?? 'lite-stg';
const MCP = `${BASE}/agent-link/mcp`;
const MIXPANEL_PROJECT = '3373228';
const MIXPANEL_WAIT_MS = 5 * 60_000;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function die(message) {
  console.error(`SETUP FAILED: ${message}`);
  process.exit(2);
}

// 1. OAuth: loopback redirect + PKCE (RFC 8252 / 7636).
async function authorize() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const reg = await fetch(`${BASE}/agent-link/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'mcp-upstream-spot-check' }),
  });
  const client = await reg.json().catch(() => ({}));
  if (!reg.ok || !client.client_id) die(`client registration returned ${reg.status}`);

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(12).toString('hex');
  const url = new URL(`${BASE}/agent-link/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    scope: 'diagram.read diagram.write',
    resource: MCP,
  })) url.searchParams.set(k, v);

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no callback within 5 minutes')), 5 * 60_000);
    server.on('request', (req, res) => {
      const got = new URL(req.url, redirectUri);
      if (got.pathname !== '/callback') return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Authorized. You can close this tab.');
      clearTimeout(timer);
      if (got.searchParams.get('state') !== state) return reject(new Error('state mismatch'));
      const c = got.searchParams.get('code');
      return c ? resolve(c) : reject(new Error(`authorize failed: ${got.searchParams.get('error') ?? 'no code'}`));
    });
    console.log(`\nOpen this URL and sign in (a browser should open by itself):\n\n  ${url}\n`);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(opener, [url.toString()], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }).finally(() => server.close());

  const tok = await fetch(`${BASE}/agent-link/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: MCP,
    }),
  });
  const token = await tok.json().catch(() => ({}));
  if (!tok.ok || !token.access_token) die(`token exchange returned ${tok.status}`);
  return { clientId: client.client_id, accessToken: token.access_token };
}

// 2. MCP calls.
let rpcId = 0;
async function callTool(accessToken, name, toolArgs) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: toolArgs } }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// 3. Mixpanel: this run's events, by its unique oauth_client_id.
async function mixpanelEvents(clientId, since) {
  const user = process.env.MIXPANEL_SA_USER;
  const secret = process.env.MIXPANEL_SA_SECRET;
  const day = new Date().toISOString().slice(0, 10);
  const prev = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const url =
    `https://data.mixpanel.com/api/2.0/export?project_id=${MIXPANEL_PROJECT}` +
    `&from_date=${prev}&to_date=${day}` +
    `&event=${encodeURIComponent(JSON.stringify(['agent_link_mcp_tool_called']))}` +
    `&where=${encodeURIComponent(`properties["oauth_client_id"] == "${clientId}"`)}`;
  const res = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}` } });
  if (!res.ok) throw new Error(`Mixpanel export returned ${res.status}`);
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).properties)
    .filter((p) => p.time * 1000 >= since - 60_000);
}

async function main() {
  console.log(`Backend: ${BASE}  Site: ${SITE}`);
  const { clientId, accessToken } = await authorize();
  const startedAt = Date.now();

  const sites = await callTool(accessToken, 'list_sites', {});
  const list = sites.body?.result?.structuredContent?.sites ?? sites.body?.result?.structuredContent ?? [];
  const site = (Array.isArray(list) ? list : []).find((s) => String(s.url ?? '').includes(`${SITE}.atlassian.net`));
  if (!site) die(`your authorization does not reach ${SITE}.atlassian.net (list_sites status ${sites.status})`);
  console.log(`cloudId for ${SITE}: ${site.cloudId}\n`);

  const a = await callTool(accessToken, 'read_diagram', { cloudId: site.cloudId, contentId: 'not-a-number' });
  check('A: non-numeric contentId is a tool error with code upstream', a.body?.error?.data?.code === 'upstream',
    `HTTP ${a.status}, code=${a.body?.error?.data?.code}`);

  const b = await callTool(accessToken, 'read_diagram', { cloudId: site.cloudId, contentId: '99999999999' });
  check('B: missing contentId is a tool error with code not_found', b.body?.error?.data?.code === 'not_found',
    `HTTP ${b.status}, code=${b.body?.error?.data?.code}`);

  if (!process.env.MIXPANEL_SA_USER || !process.env.MIXPANEL_SA_SECRET) {
    console.log(`\nMixpanel not checked (MIXPANEL_SA_USER / MIXPANEL_SA_SECRET unset).`);
    console.log(`Check agent_link_mcp_tool_called where oauth_client_id = "${clientId}" in project ${MIXPANEL_PROJECT}.`);
  } else {
    console.log(`\nWaiting for Mixpanel (up to ${MIXPANEL_WAIT_MS / 60_000} min) for oauth_client_id ${clientId} ...`);
    let events = [];
    for (const deadline = Date.now() + MIXPANEL_WAIT_MS; Date.now() < deadline; ) {
      events = (await mixpanelEvents(clientId, startedAt)).filter((p) => p.mcp_tool === 'read_diagram');
      if (events.length >= 2) break;
      await new Promise((r) => setTimeout(r, 15_000));
    }
    const ea = events.find((p) => p.reason === 'upstream');
    const eb = events.find((p) => p.reason === 'not_found');
    check('Mixpanel A: failure_step=diagram_read, upstream_status=400',
      ea?.failure_step === 'diagram_read' && ea?.upstream_status === 400,
      ea ? `failure_step=${ea.failure_step}, upstream_status=${ea.upstream_status}` : 'event not found');
    check('Mixpanel B: not_found carries no failure_step / upstream_status',
      !!eb && eb.failure_step === undefined && eb.upstream_status === undefined,
      eb ? `failure_step=${eb.failure_step}, upstream_status=${eb.upstream_status}` : 'event not found');
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => die(e.message));
