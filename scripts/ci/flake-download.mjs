import { execFile, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Each worker owns a run, so reports with recurring names cannot overwrite one
// another. The limit applies to both inventory requests and downloads.
export async function downloadReports(runIds, { list, save, warn = console.warn, concurrency = 4, root = 'blobs' }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid concurrency');
  if (!Array.isArray(runIds) || runIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(runIds).size !== runIds.length) throw new Error('Invalid or duplicate run ID');
  let next = 0, downloaded = 0, failed = 0, aborted = false;
  const worker = async () => {
    try {
      while (!aborted && next < runIds.length) {
        const run = runIds[next++];
        const artifacts = await list(run);
        if (!Array.isArray(artifacts)) throw new Error(`Invalid artifact inventory for run ${run}`);
        const names = new Set();
        for (const item of artifacts) {
          if (aborted) break;
          if (typeof item?.name !== 'string') throw new Error(`Invalid artifact inventory for run ${run}`);
          if (!item.name.startsWith('blob-report-') || item.expired) continue;
          if (!Number.isSafeInteger(item.id) || item.id <= 0 || /[\\/\0]/.test(item.name) || item.name.includes('..') || names.has(item.name)) throw new Error(`Invalid or duplicate artifact name for run ${run}`);
          names.add(item.name);
          const suite = item.name.slice('blob-report-'.length).replace(/-shard-.*$/, '');
          if (!suite) throw new Error(`Invalid artifact name for run ${run}`);
          const path = join(root, String(run), suite, `${item.name}.zip`);
          try { await save(item.id, path); downloaded++; }
          catch (error) {
            // Stop rather than hammer GitHub after an authorization or rate-limit response.
            if (/rate limit|HTTP (?:403|429)/i.test(String(error.message))) throw error;
            failed++; warn(`could not download artifact ${item.id} (${item.name}) of run ${run}: ${error.message}`);
          }
        }
      }
    } catch (error) { aborted = true; throw error; }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, runIds.length) }, worker));
  const error = results.find(result => result.status === 'rejected');
  if (error) throw error.reason;
  return { downloaded, failed };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.argv[2]) throw new Error('GITHUB_REPOSITORY and run ID file are required');
  const ids = readFileSync(process.argv[2], 'utf8').split(/\s+/).filter(Boolean).map(Number);
  const list = async run => {
    const { stdout } = await execFileAsync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${run}/artifacts?per_page=100`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const pages = JSON.parse(stdout);
    if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.artifacts))) throw new Error(`Invalid artifact inventory for run ${run}`);
    return pages.flatMap(page => page.artifacts);
  };
  const save = async (id, path) => {
    mkdirSync(dirname(path), { recursive: true });
    const child = spawn('gh', ['api', `repos/${repo}/actions/artifacts/${id}/zip`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`gh exited ${code}: ${stderr.trim()}`))); });
    try { await Promise.all([pipeline(child.stdout, createWriteStream(path)), exit]); }
    catch (error) { child.kill(); rmSync(path, { force: true }); throw error; }
  };
  const concurrency = Number(process.env.FLAKE_DOWNLOAD_CONCURRENCY || 4);
  const result = await downloadReports(ids, { list, save, concurrency, warn: message => console.warn(`::warning::${message}`) });
  console.log(`Downloaded ${result.downloaded} blob reports; ${result.failed} failed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
