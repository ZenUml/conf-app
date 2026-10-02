#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VARIANTS = ['Lite', 'Full', 'Diagramly', 'AsyncAPI'];
const normalized = (job) => job.status !== 'completed' ? 'failure' : job.conclusion === 'success' ? 'success' : job.conclusion === 'skipped' ? 'skipped' : job.conclusion === 'cancelled' ? 'cancelled' : 'failure';

export function aggregateRegression(run, jobs, target) {
  if (!target || typeof target.sha !== 'string' || !target.sha.trim()) throw new Error('Verified regression target SHA is required');
  if (!run?.id || !run.html_url || !Number.isInteger(Number(run.run_attempt)) || !Array.isArray(jobs)) throw new Error('Invalid regression run or jobs');
  return {
    run_id: String(run.id), attempt: Number(run.run_attempt), sha: target.sha, url: run.html_url,
    variants: VARIANTS.map((variant) => {
      const grouped = jobs.filter(job => typeof job.name === 'string' && job.name.startsWith(`${variant} /`));
      const failures = [];
      const stage = (field, match) => {
        const relevant = grouped.filter(job => match.test(job.name));
        if (!relevant.length) {
          failures.push({ name: `Missing ${field} coverage for ${variant}`, url: run.html_url });
          return run.conclusion === 'cancelled' ? 'cancelled' : 'skipped';
        }
        for (const job of relevant) if (normalized(job) !== 'success') failures.push({ name: `${job.name}: ${job.conclusion || job.status || 'unknown'}`, url: job.html_url || run.html_url });
        const states = relevant.map(normalized);
        return states.includes('failure') ? 'failure' : states.includes('cancelled') ? 'cancelled' : states.includes('skipped') ? 'skipped' : 'success';
      };
      const deployment = stage('deployment', /deploy/i);
      const version = stage('version', /verify[ -]version/i);
      // Only execution/evidence jobs establish coverage. Auth reuse and report
      // merging legitimately skip on healthy runs and are not test verdicts.
      const suites = ['E2E full live regression', ...(variant === 'AsyncAPI' ? [] : ['E2E full render regression'])];
      const suiteStates = suites.map(suite => {
        const prefix = `${variant} / ${suite} / `;
        const suiteJobs = grouped.filter(job => job.name.startsWith(prefix));
        const shards = suiteJobs.filter(job => /\/ shard \d+\/\d+$/.test(job.name));
        const evidence = suiteJobs.filter(job => job.name.endsWith('/ aggregate concrete evidence'));
        const planning = suiteJobs.filter(job => job.name.endsWith('/ plan concrete tests'));
        const required = [...planning, ...shards, ...evidence];
        if (!shards.length || evidence.length !== 1 || planning.length !== 1) {
          failures.push({ name: `Missing concrete ${suite} coverage for ${variant}`, url: run.html_url });
          return run.conclusion === 'cancelled' ? 'cancelled' : 'skipped';
        }
        const totals = shards.map(job => Number(job.name.match(/\/(\d+)$/)[1]));
        const indexes = new Set(shards.map(job => Number(job.name.match(/shard (\d+)\//)[1])));
        if (new Set(totals).size !== 1 || indexes.size !== totals[0] || [...indexes].some(index => index < 1 || index > totals[0])) {
          failures.push({ name: `Incomplete shard inventory for ${suite}`, url: run.html_url });
          return 'failure';
        }
        for (const job of required) if (normalized(job) !== 'success') failures.push({ name: `${job.name}: ${job.conclusion || job.status || 'unknown'}`, url: job.html_url || run.html_url });
        const states = required.map(normalized);
        return states.includes('failure') ? 'failure' : states.includes('cancelled') ? 'cancelled' : states.includes('skipped') ? 'skipped' : 'success';
      });
      const tests = suiteStates.includes('failure') ? 'failure' : suiteStates.includes('cancelled') ? 'cancelled' : suiteStates.includes('skipped') ? 'skipped' : 'success';
      // Preserve failures outside recognized stages, including lost transaction coverage.
      for (const job of grouped) if (!/deploy|verify[ -]version|E2E/i.test(job.name) && normalized(job) === 'failure') failures.push({ name: `${job.name}: ${job.conclusion || job.status}`, url: job.html_url || run.html_url });
      return { variant: variant.toLowerCase(), deployment, version, tests, failures };
    }),
  };
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const jsonFile = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function main() {
  const argv = process.argv.slice(2);
  const options = {};
  while (argv.length) {
    const key = argv.shift();
    if (!['--run', '--output', '--repo', '--jobs', '--run-json', '--target'].includes(key) || !argv.length || argv[0].startsWith('--')) throw new Error('Invalid arguments');
    options[key] = argv.shift();
  }
  if (!options['--output']) throw new Error('--output is required');
  let run; let jobs; let target;
  if (options['--jobs'] || options['--run-json']) {
    if (!options['--jobs'] || !options['--run-json'] || !options['--target']) throw new Error('Offline mode requires --jobs, --run-json and --target');
    run = await jsonFile(options['--run-json']);
    const data = await jsonFile(options['--jobs']);
    jobs = Array.isArray(data) ? data : data.jobs;
    target = await jsonFile(options['--target']);
  } else {
    if (!/^\d+$/.test(options['--run'] || '')) throw new Error('--run requires a numeric run ID');
    const repo = options['--repo'] || process.env.GITHUB_REPOSITORY || 'ZenUml/conf-app';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
    run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${options['--run']}`]));
    const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`]));
    jobs = pages.flatMap(page => page.jobs || []);
    if (options['--target']) target = await jsonFile(options['--target']);
    else {
      const directory = await mkdtemp(join(tmpdir(), 'regression-target-'));
      try {
        gh(['run', 'download', String(run.id), '--repo', repo, '--name', `regression-target-${run.id}`, '--dir', directory]);
        const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
        if (files.length !== 1) throw new Error('Target artifact must contain one JSON file');
        target = await jsonFile(join(directory, files[0]));
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
  await writeFile(options['--output'], `${JSON.stringify(aggregateRegression(run, jobs, target), null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Regression result collection failed: verify GitHub access, complete jobs and target artifact.'); process.exitCode = 1; });
