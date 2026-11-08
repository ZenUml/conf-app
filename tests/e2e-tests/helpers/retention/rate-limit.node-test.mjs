import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitedRequest } from './rate-limit.mjs';
test('spaces requests and retries read rate limits', async () => {
  let time = 0; let calls = 0; const delays = [];
  const request = { get: async () => ({ status: () => ++calls === 1 ? 429 : 200, headers: () => ({ 'retry-after': '2' }) }) };
  const limited = rateLimitedRequest(request, { intervalMs: 500, now: () => time, wait: async ms => { delays.push(ms); time += ms; } });
  assert.equal((await limited.get('x')).status(), 200);
  assert.deepEqual(delays, [2000]);
});
test('never retries an ambiguous write', async () => {
  let calls = 0;
  const limited = rateLimitedRequest({ post: async () => { calls++; throw Error('lost connection'); } }, { intervalMs: 0 });
  await assert.rejects(limited.post('x'), /lost connection/); assert.equal(calls, 1);
});
