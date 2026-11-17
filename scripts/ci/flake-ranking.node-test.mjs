import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const filter = (name, input, args = []) => {
  const result = spawnSync('jq', [...args, '-f', `scripts/ci/${name}.jq`], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

test('ranks distinct runs by suite and project, retaining the worst shard result', () => {
  const report = status => JSON.stringify({ suites: [{ specs: [{ file: 'insert/graph.spec.ts', title: 'insert graph', tests: [{ projectName: 'chromium', status }] }] }] });
  const rows = [
    ['1', 'full-prod-smoke', 'flaky'], ['1', 'lite-prod-smoke', 'expected'],
    ['1', 'diagramly-prod-smoke', 'expected'], ['1', 'full-prod-smoke', 'expected'],
    ['2', 'full-prod-smoke', 'unexpected'], ['2', 'full-prod-smoke', 'flaky'],
    ['3', 'full-prod-smoke', 'skipped']
  ].map(([run, suite, status]) => filter('flake-rows', report(status), ['-c', '--arg', 'run', run, '--arg', 'suite', suite])).join('');
  const ranking = filter('flake-ranking', rows, ['-r', '-s']);
  assert.match(ranking, /full-prod-smoke.*chromium.*insert\/graph\.spec\.ts.*\| 2 \| 1 \| 1 \| 2 \|/);
  assert.doesNotMatch(ranking, /lite-prod-smoke|diagramly-prod-smoke/);
  const otherProject = filter('flake-rows', JSON.stringify({ suites: [{ specs: [{file:'x', title:'t', tests:[{projectName:'firefox', status:'flaky'}, {projectName:'chromium', status:'unexpected'}]}]}] }), ['-c', '--arg', 'run', '4', '--arg', 'suite', 'full']);
  const separate = filter('flake-ranking', otherProject, ['-r', '-s']);
  assert.match(separate, /firefox.*\| 1 \| 1 \| 0 \|/);
  assert.match(separate, /chromium.*\| 1 \| 0 \| 1 \|/);
});
