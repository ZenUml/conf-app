import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const epoch = value => {
  const milliseconds = Date.parse(value ?? '');
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

/** Add GitHub scheduler timings without mixing them into test execution time. */
export function attachWorkflowTiming(evidence, jobs, jobPrefix) {
  const shards = (jobs ?? []).filter(job => typeof job.name === 'string'
    && job.name.startsWith(`${jobPrefix} / shard `));
  const queue = shards.map(job => {
    const created = epoch(job.created_at), started = epoch(job.started_at);
    return created === null || started === null ? null : Math.max(0, started - created);
  }).filter(value => value !== null);
  const started = shards.map(job => epoch(job.started_at)).filter(value => value !== null);
  const completed = shards.map(job => epoch(job.completed_at)).filter(value => value !== null);
  evidence.metrics = {
    ...(evidence.metrics ?? {}),
    queue_critical_path_ms: queue.length === shards.length && queue.length ? Math.max(...queue) : null,
    queue_total_ms: queue.length === shards.length ? queue.reduce((total, value) => total + value, 0) : null,
    e2e_critical_path_ms: started.length === shards.length && completed.length === shards.length
      ? Math.max(...completed) - Math.min(...started) : null,
    workflow_timing_source: shards.length ? 'github-actions-jobs-api' : 'unavailable',
  };
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => value.startsWith('--') ? [...out, [value.slice(2), all[index + 1]]] : out, []));
  const evidence = JSON.parse(readFileSync(args.evidence));
  const jobs = JSON.parse(readFileSync(args.jobs)).jobs ?? JSON.parse(readFileSync(args.jobs));
  writeFileSync(args.output ?? args.evidence, JSON.stringify(attachWorkflowTiming(evidence, jobs, args.prefix), null, 2));
}
