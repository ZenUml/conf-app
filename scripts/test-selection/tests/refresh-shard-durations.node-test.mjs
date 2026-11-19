import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDurations } from '../refresh-shard-durations.mjs';

const end = (id, status, duration) => ({ method: 'onTestEnd', params: { test: { testId: id }, result: { status, duration } } });
const plan = { variant: 'lite', coverage: 'full', tests: [
  { id: 'a', project: 'fullscreen', file: 'a.spec.ts' },
  { id: 'b', project: 'fullscreen', file: 'a.spec.ts' },
  { id: 'c', project: 'insert', file: 'b.spec.ts' },
] };

test('uses the final passing attempt and the per-file median across complete runs', () => {
  const samples = [
    { runId: 1, plan, reports: [[end('auth', 'passed', 99), end('a', 'failed', 50), end('a', 'passed', 100), end('b', 'passed', 300), end('c', 'skipped', 0)]] },
    { runId: 2, plan, reports: [[end('a', 'passed', 200), end('b', 'passed', 400), end('c', 'passed', 500)]] },
  ];
  assert.deepEqual(estimateDurations(samples, 40000), {
    source_runs: [1, 2], unit: 'milliseconds per passing test, median by project and file', default_ms: 40000,
    estimates: { 'fullscreen:a.spec.ts': 250, 'insert:b.spec.ts': 500 },
  });
});

test('rejects partial, failed, duplicate, or non-full samples', () => {
  const sample = { runId: 1, plan, reports: [[end('a', 'passed', 100), end('b', 'passed', 100), end('c', 'passed', 100)]] };
  assert.throws(() => estimateDurations([{ ...sample, reports: [[end('a', 'passed', 100)]] }]), /missing/i);
  assert.throws(() => estimateDurations([{ ...sample, reports: [[end('a', 'failed', 100), end('b', 'passed', 100), end('c', 'passed', 100)]] }]), /failed/i);
  assert.throws(() => estimateDurations([{ ...sample, reports: [...sample.reports, [end('a', 'passed', 100)]] }]), /multiple reports/i);
  assert.throws(() => estimateDurations([{ ...sample, plan: { ...plan, coverage: 'selected' } }]), /full/i);
  assert.throws(() => estimateDurations([sample, sample]), /duplicate/i);
});

test('CLI reads a manifest and emits an importable module', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'shard-refresh-'));
  try {
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
    writeFileSync(join(dir, 'report.jsonl'), [end('a', 'passed', 100), end('b', 'passed', 200), end('c', 'skipped', 0)].map(JSON.stringify).join('\n'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ runs: [{ run_id: 42, plan: 'plan.json', reports: ['report.jsonl'] }] }));
    const cli = new URL('../refresh-shard-durations.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [cli, join(dir, 'manifest.json')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const module = await import(`data:text/javascript,${encodeURIComponent(result.stdout)}`);
    assert.equal(module.default.estimates['fullscreen:a.spec.ts'], 150);
    assert.deepEqual(module.default.source_runs, [42]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
