import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedApiOrigin, runSupportCli, validateMutation } from './fullscreen-recovery-support.mjs';

const requestId = '1b3cb049-019b-4a83-869d-0f547381aa3b';
const commandId = '3072aeae-aecd-45c9-9980-57dfde144508';
const secret = 'operator-secret-must-not-be-printed';
const env = {
  FULLSCREEN_RECOVERY_API_URL: 'https://conf-stg-lite.zenuml.com',
  FULLSCREEN_RECOVERY_OPERATOR_TOKEN: secret,
};
const jsonResponse = (body) => Response.json(body);
const capture = () => {
  const out = [], errors = [];
  return { out, errors, output: line => out.push(line), error: line => errors.push(line) };
};

test('allowlists only exact HTTPS backend origins and loopback development', () => {
  assert.equal(allowedApiOrigin('https://conf-lite.zenuml.com'), 'https://conf-lite.zenuml.com');
  assert.equal(allowedApiOrigin('https://conf-stg-lite.zenuml.com'), 'https://conf-stg-lite.zenuml.com');
  assert.equal(allowedApiOrigin('https://zenapi.zenuml.com'), 'https://zenapi.zenuml.com');
  assert.equal(allowedApiOrigin('http://localhost:1355'), 'http://localhost:1355');
  for (const url of [
    'http://conf-lite.zenuml.com', 'https://conf-lite.zenuml.com.evil.test',
    'https://conf-lite.zenuml.com:8443', 'https://user:pass@conf-lite.zenuml.com',
    'https://conf-lite.zenuml.com/other', 'https://example.test',
  ]) assert.throws(() => allowedApiOrigin(url));
});

test('read commands target expected endpoints and keep bearer out of output', async () => {
  const seen = [];
  const io = capture();
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return jsonResponse({ ok: true });
  };
  assert.equal(await runSupportCli(['list'], { env, fetchImpl, ...io }), 0);
  assert.equal(await runSupportCli(['show', '--id', requestId], { env, fetchImpl, ...io }), 0);
  assert.equal(await runSupportCli(['preview', '--id', requestId, '--time-zone', 'Australia/Melbourne'], { env, fetchImpl, ...io }), 0);
  assert.equal(await runSupportCli(['status', '--id', requestId], { env, fetchImpl, ...io }), 0);
  assert.equal(seen[0].url, 'https://conf-stg-lite.zenuml.com/api/support/fullscreen-recovery');
  assert.match(seen[1].url, /\?id=/);
  assert.match(seen[2].url, /timeZone=Australia%2FMelbourne/);
  assert.match(seen[3].url, /view=status/);
  assert.equal(seen.every(x => x.init.method === 'GET' && x.init.redirect === 'error'), true);
  assert.equal(io.out.join('\n').includes(secret), false);
});

test('mutations are dry runs without a network call and preserve commandId', async () => {
  const io = capture();
  const body = { action: 'extend', requestId, commandId, reason: 'Approved by support' };
  const code = await runSupportCli(['extend', '--input', '/private/action.json'], {
    env, readFile: () => JSON.stringify(body),
    fetchImpl: () => { throw new Error('must not fetch'); }, ...io,
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]), {
    dryRun: true, action: 'extend', requestId, commandId,
  });
  assert.equal(io.out.join('\n').includes('Approved by support'), false);
  assert.equal(io.out.join('\n').includes(secret), false);
});

test('confirmed send requires an exact preview hash and submits only file data', async () => {
  const body = { action: 'send', requestId, previewHash: 'a'.repeat(64), timeZone: 'UTC' };
  const io = capture();
  let received;
  const code = await runSupportCli(['send', '--input', '/private/send.json', '--confirm'], {
    env, readFile: () => JSON.stringify(body),
    fetchImpl: async (url, init) => {
      received = { url: String(url), init };
      return jsonResponse({ mail: { state: 'accepted' } });
    }, ...io,
  });
  assert.equal(code, 0);
  assert.equal(received.url, 'https://conf-stg-lite.zenuml.com/api/support/fullscreen-recovery-mail');
  assert.deepEqual(JSON.parse(received.init.body), body);
  assert.equal(received.init.method, 'POST');
  assert.equal(received.init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(io.out.join('\n').includes(secret), false);
  assert.throws(() => validateMutation('send', { ...body, previewHash: 'a'.repeat(63) }));
});

test('rejects mismatched actions, missing command IDs, and backend errors without token output', async () => {
  const bad = capture();
  const code = await runSupportCli(['outcome', '--input', 'ignored', '--confirm'], {
    env, readFile: () => JSON.stringify({ action: 'outcome', requestId, reason: 'Closed', supportOutcome: 'closed' }),
    fetchImpl: () => { throw new Error('must not fetch'); }, ...bad,
  });
  assert.equal(code, 1);
  assert.match(bad.errors[0], /Input body fields/);
  const remote = capture();
  assert.equal(await runSupportCli(['list'], {
    env, fetchImpl: async () => Response.json({ error: 'unauthorized' }, { status: 401 }), ...remote,
  }), 1);
  assert.equal(remote.errors.join('\n').includes(secret), false);
});
