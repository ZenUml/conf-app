import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planApiLanes, verifyApiManifest, githubCandidateFiles } from '../api-plan.mjs';
import { API_LANES } from '../../../tests/e2e-tests/config/api-lanes.mjs';

const selection = scenarios => ({ decision_source: 'agent', mode: 'selected', scenarios });
const manifest = 'tests/integration/oauth-token/scenarios.json', spec = 'tests/integration/oauth-token/oauth.test.ts', config = 'vitest.oauth-integration.config.ts';
const command = 'vitest run --config vitest.oauth-integration.config.ts';
const absent = { 'package.json': JSON.stringify({ scripts: {} }), [manifest]: null, [spec]: null, [config]: null };
const complete = { ...absent, 'package.json': JSON.stringify({ scripts: { 'test:oauth-integration': command } }), [manifest]: JSON.stringify({scenarios: API_LANES[0].scenarios}), [spec]: 'test', [config]: 'config' };
test('selected API pairs require the complete candidate suite; full mode skips only an absent suite', () => {
  for (const pair of API_LANES[0].scenarios) {
    assert.deepEqual(planApiLanes(selection([pair]), complete), ['oauth-token']);
    assert.throws(() => planApiLanes(selection([pair]), absent), /unavailable/);
  }
  assert.deepEqual(planApiLanes(selection([]), absent), []);
  assert.deepEqual(planApiLanes({ ...selection([]), mode: 'all' }, absent), []);
  assert.deepEqual(planApiLanes({ ...selection([]), mode: 'all' }, complete), ['oauth-token']);
  for (const path of [manifest, spec, config]) assert.throws(() => planApiLanes({ ...selection([]), mode: 'all' }, { ...complete, [path]: null }), /incomplete/);
  assert.throws(() => planApiLanes({ ...selection([]), mode: 'all' }, { ...absent, [spec]: 'test' }), /incomplete/);
  assert.throws(() => planApiLanes({ ...selection([]), mode: 'all' }, { ...complete, 'package.json': '{}' }), /incomplete/);
  assert.throws(() => planApiLanes(selection(API_LANES[0].scenarios), { ...complete, [manifest]: JSON.stringify({ scenarios: [API_LANES[0].scenarios[0]] }) }), /differs/);
  assert.throws(() => planApiLanes({ mode: 'all', scenarios: [] }, complete));
});
test('candidate manifest must match the trusted registry exactly', () => {
  const root = mkdtempSync(join(tmpdir(), 'api-lane-'));
  try {
    const dir = join(root, 'tests/integration/oauth-token'); mkdirSync(dir, { recursive: true });
    const file = join(dir, 'scenarios.json');
    assert.throws(() => verifyApiManifest('oauth-token', root));
    writeFileSync(file, complete[manifest]);
    assert.equal(verifyApiManifest('oauth-token', root).scenarios.length, 2);
    writeFileSync(file, JSON.stringify({ scenarios: [API_LANES[0].scenarios[0]] }));
    assert.throws(() => verifyApiManifest('oauth-token', root));
    assert.throws(() => verifyApiManifest('unknown', root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('candidate discovery uses the exact commit tree and rejects incomplete inventory', () => {
  const sha = 'a'.repeat(40), tree = 'b'.repeat(40), calls = [];
  const api = path => { calls.push(path); if (path.includes('/commits/')) return {tree:{sha:tree}}; if (path.includes('/trees/')) return {truncated:false,tree:Object.keys(complete).map((path,i)=>({path,type:'blob',sha:String(i)}))}; const key=Object.keys(complete)[Number(path.split('/').at(-1))]; return {encoding:'base64',content:Buffer.from(complete[key]).toString('base64')}; };
  assert.deepEqual(planApiLanes(selection(API_LANES[0].scenarios), githubCandidateFiles('owner/repo', sha, api)), ['oauth-token']);
  assert.match(calls[0], new RegExp(sha)); assert.match(calls[1], new RegExp(tree));
  assert.throws(() => githubCandidateFiles('owner/repo', sha, path => path.includes('/commits/') ? {tree:{sha:tree}} : {truncated:true,tree:[]}), /incomplete/);
});
