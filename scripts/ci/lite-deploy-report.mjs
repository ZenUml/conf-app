#!/usr/bin/env node
import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export function summarize(jobs, evidence, pairs) {
  const samples = [];
  for (let pair = 1; pair <= pairs; pair++) {
    for (const mode of ['baseline', 'candidate']) {
      const sample = `${mode}-${pair}`;
      const proof = evidence.find(item => item.sample === sample);
      const job = jobs.find(item => item.name === `${sample} / deploy`);
      if (!proof?.backend_marker_verified || !job || job.conclusion !== 'success') throw new Error(`Missing successful verified sample: ${sample}`);
      const elapsedMs = Date.parse(job.completed_at) - Date.parse(job.started_at);
      const deployMs = Date.parse(proof.deployment_completed_at) - Date.parse(job.started_at);
      if (!(elapsedMs > 0) || !(deployMs > 0) || deployMs > elapsedMs) throw new Error(`Invalid clock for ${sample}`);
      samples.push({ sample, mode, job_id: job.id, job_duration_ms: elapsedMs, deployment_duration_ms: deployMs, ...proof });
    }
  }
  for (const key of ['source_sha', 'tooling_sha', 'manifest_sha256', 'assets_sha256']) if (new Set(samples.map(sample => sample[key])).size !== 1) throw new Error(`Unequal ${key} across arms`);
  const cleanSamples = samples.filter(sample => sample.forge_attempts?.length === 1 && sample.forge_attempts[0].exit_code === 0);
  const baselineMs = median(samples.filter(sample => sample.mode === 'baseline').map(sample => sample.job_duration_ms));
  const candidateMs = median(samples.filter(sample => sample.mode === 'candidate').map(sample => sample.job_duration_ms));
  return { schema_version: 1, samples, metric: 'GitHub deploy-job started_at through completed_at, including setup, install, configuration, build/cache, migration, lint, both deploys, install/upgrade, probe, metadata upload and post steps; excludes queue and separate smoke validation', pairs, baseline_median_ms: baselineMs, candidate_median_ms: candidateMs, reduction_fraction: 1 - candidateMs / baselineMs, target_met: pairs >= 3 && cleanSamples.length === samples.length && candidateMs <= baselineMs * 0.8, clean_samples: cleanSamples.map(sample => sample.sample), retries_present: cleanSamples.length !== samples.length, preliminary: pairs < 3 };
}

async function main() {
  const root = process.env.EVIDENCE_DIRECTORY || 'benchmark-evidence';
  const evidence = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    try { evidence.push(JSON.parse(await readFile(`${root}/${directory.name}/lite-deploy-evidence.json`, 'utf8'))); }
    catch { /* Non-evidence artifacts are excluded; expected samples are required above. */ }
  }
  const jobs = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error('GitHub timing lookup failed');
    const body = await response.json();
    if (!Array.isArray(body.jobs)) throw new Error('GitHub returned no timing jobs');
    jobs.push(...body.jobs);
    if (body.jobs.length < 100) break;
  }
  const report = summarize(jobs, evidence, Number(process.env.BENCHMARK_PAIRS));
  const migration = jobs.find(job => job.name === 'Shared staging D1 migrations');
  if (migration?.conclusion !== 'success') throw new Error('Shared migration job did not complete successfully');
  report.shared_migration_job = { job_id: migration.id, duration_ms: Date.parse(migration.completed_at) - Date.parse(migration.started_at), included_in_deploy_median: false };
  report.workflow_elapsed_through_report_start_ms = Date.now() - Math.min(...jobs.map(job => Date.parse(job.started_at)).filter(Number.isFinite));
  await writeFile('lite-deploy-benchmark.json', JSON.stringify(report, null, 2));
  const lines = ['## Lite staging deployment experiment', '', report.metric, '', '| Sample | Full job seconds | Deployment completion seconds |', '|---|---:|---:|', ...report.samples.map(item => `| ${item.sample} | ${(item.job_duration_ms / 1000).toFixed(1)} | ${(item.deployment_duration_ms / 1000).toFixed(1)} |`), '', `Median baseline ${(report.baseline_median_ms / 1000).toFixed(1)}s; candidate ${(report.candidate_median_ms / 1000).toFixed(1)}s; reduction ${(100 * report.reduction_fraction).toFixed(1)}%.`, `Shared migration job: ${(report.shared_migration_job.duration_ms / 1000).toFixed(1)}s, excluded from both deploy-job medians as in normal main CI.`, report.preliminary ? 'Preliminary pair only; three pairs are required for the 20% decision.' : `20% threshold: ${report.target_met ? 'met' : 'not met'}.`, ''];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
