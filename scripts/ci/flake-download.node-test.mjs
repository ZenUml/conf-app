import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadReports } from './flake-download.mjs';

const artifact = (id, name, expired = false) => ({ id, name, expired });

test('downloads eligible reports with bounded concurrency and isolated run/suite paths', async () => {
  let active = 0, peak = 0;
  const saved = [];
  const result = await downloadReports([101, 102, 103, 104, 105], {
    concurrency: 3,
    list: async run => [artifact(run * 10, 'blob-report-lite-stg-shard-1'), artifact(run * 10 + 1, 'other'), artifact(run * 10 + 2, 'blob-report-old-shard-1', true)],
    save: async (id, path) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); saved.push({ id, path }); active--; },
  });
  assert.equal(peak, 3);
  assert.equal(result.downloaded, 5);
  assert.equal(result.failed, 0);
  assert.equal(new Set(saved.map(x => x.path)).size, 5);
  assert.ok(saved.some(x => x.path.endsWith('101/lite-stg/blob-report-lite-stg-shard-1.zip')));
});

test('warns on an artifact failure but continues other reports', async () => {
  const warnings = [], saved = [];
  const result = await downloadReports([1], {
    list: async () => [artifact(1, 'blob-report-a-shard-1'), artifact(2, 'blob-report-a-shard-2')],
    save: async id => { if (id === 1) throw new Error('network'); saved.push(id); },
    warn: message => warnings.push(message),
  });
  assert.deepEqual(saved, [2]);
  assert.equal(result.failed, 1);
  assert.match(warnings[0], /1.*network/);
});

test('rejects invalid inventory or unsafe paths instead of silently omitting reports', async () => {
  await assert.rejects(downloadReports([1], { list: async () => null, save: async () => {} }), /inventory/);
  await assert.rejects(downloadReports([1], { list: async () => [artifact(7, 'blob-report-../../escape-shard-1')], save: async () => {} }), /name/);
  await assert.rejects(downloadReports(['../bad'], { list: async () => [], save: async () => {} }), /run/);
});

test('CLI lists paginated artifacts and writes the downloaded bytes', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } = await import('node:fs');
  const { join, delimiter } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'flake-download-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, `#!/bin/sh\ncase "$*" in\n  *'/runs/123/artifacts?'*) printf '%s' '[{"artifacts":[{"id":42,"name":"blob-report-lite-shard-1","expired":false},{"id":43,"name":"blob-report-lite-shard-2","expired":false}]}]' ;;\n  *'/artifacts/42/zip'*) printf 'zip-bytes' ;;\n  *'/artifacts/43/zip'*) printf 'partial'; exit 1 ;;\n  *) exit 1 ;;\nesac\n`);
    chmodSync(gh, 0o755);
    writeFileSync(join(dir, 'runs.txt'), '123\n');
    const script = new URL('./flake-download.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [script, 'runs.txt'], { cwd: dir, env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'example/repo' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(dir, 'blobs/123/lite/blob-report-lite-shard-1.zip'), 'utf8'), 'zip-bytes');
    assert.match(result.stdout, /Downloaded 1 blob reports; 1 failed/);
    assert.match(result.stderr, /could not download artifact 43/);
    assert.throws(() => readFileSync(join(dir, 'blobs/123/lite/blob-report-lite-shard-2.zip')), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
