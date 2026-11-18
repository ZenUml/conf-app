import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const [inputArg, outputArg, executableArg] = process.argv.slice(2);
if (!inputArg || !outputArg || !executableArg) throw new Error('Expected input directory, rows output and Playwright executable');
const input = resolve(inputArg);
const output = resolve(outputArg);
const executable = resolve(executableArg);
const filter = fileURLToPath(new URL('./flake-rows.jq', import.meta.url));
const workerCount = 2;
const groups = [];
for (const run of await readdir(input, { withFileTypes: true })) {
  if (!run.isDirectory()) continue;
  for (const suite of await readdir(join(input, run.name), { withFileTypes: true })) {
    if (suite.isDirectory()) groups.push({ run: run.name, suite: suite.name, dir: join(input, run.name, suite.name) });
  }
}
groups.sort((a, b) => a.dir.localeCompare(b.dir));
const tmp = await mkdtemp(join(tmpdir(), 'flake-merge-'));
const rowPaths = new Array(groups.length);
async function run(command, args, stdoutPath, stderrPath) {
  const stdout = await open(stdoutPath, 'w');
  try {
    const stderr = await open(stderrPath, 'w');
    try {
      return await new Promise((resolveRun, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', stdout.fd, stderr.fd] });
        child.once('error', reject);
        child.once('close', (code, signal) => resolveRun({ code, signal }));
      });
    } finally { await stderr.close(); }
  } finally { await stdout.close(); }
}
try {
  let next = 0;
  async function worker() {
    while (next < groups.length) {
      const index = next++;
      const group = groups[index];
      const json = join(tmp, `${index}.json`);
      const err = join(tmp, `${index}.err`);
      const rows = join(tmp, `${index}.jsonl`);
      const merged = await run(executable, ['merge-reports', '--reporter=json', group.dir], json, err);
      if (merged.code !== 0 || merged.signal) {
        const detail = (await readFile(err, 'utf8')).slice(0, 300).replace(/[\r\n]+/g, ' ');
        console.warn(`::warning::merge-reports failed for run ${group.run} suite ${group.suite}: ${detail}`);
        continue;
      }
      if ((await stat(json)).size === 0) throw new Error(`Empty report for run ${group.run} suite ${group.suite}`);
      const parsed = await run('jq', ['-c', '--arg', 'run', group.run, '--arg', 'suite', group.suite, '-f', filter, json], rows, err);
      if (parsed.code !== 0 || parsed.signal) throw new Error(`Cannot parse report for run ${group.run} suite ${group.suite}: ${(await readFile(err, 'utf8')).slice(0, 300)}`);
      rowPaths[index] = rows;
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(workerCount, groups.length) }, worker));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  await writeFile(output, '');
  for (const rows of rowPaths) if (rows) await pipeline(createReadStream(rows), createWriteStream(output, { flags: 'a' }));
  console.log(`Processed ${groups.length} run/suite groups with ${workerCount} workers`);
} finally { await rm(tmp, { recursive: true, force: true }); }
