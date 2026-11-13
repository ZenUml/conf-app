import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use only full Lite runs. An incomplete report must not silently make slow
// tests look cheap. Retries within one report use their final result.
export function estimateDurations(samples, defaultMs = 40000) {
  if (!Array.isArray(samples) || !samples.length || !Number.isFinite(defaultMs) || defaultMs <= 0) throw new Error('Samples and a positive default are required');
  const runs = new Set(), measurements = new Map();
  for (const { runId, plan, reports } of samples) {
    if (!Number.isSafeInteger(runId) || runId <= 0 || runs.has(runId)) throw new Error('Invalid or duplicate run ID');
    runs.add(runId);
    if (plan?.variant !== 'lite' || plan.coverage !== 'full' || !Array.isArray(plan.tests) || !plan.tests.length) throw new Error('A full Lite plan is required');
    const tests = new Map();
    for (const t of plan.tests) {
      if (!t.id || !t.project || !t.file || tests.has(t.id)) throw new Error('Invalid or duplicate planned test');
      tests.set(t.id, t);
    }
    if (!Array.isArray(reports) || !reports.length) throw new Error('Missing reports');
    const results = new Map();
    reports.forEach((events, reportIndex) => {
      if (!Array.isArray(events)) throw new Error('Invalid report');
      for (const event of events) {
        if (event?.method !== 'onTestEnd') continue;
        const id = event.params?.test?.testId;
        if (!tests.has(id)) continue; // setup dependencies are not in the plan
        if (results.has(id) && results.get(id).reportIndex !== reportIndex) throw new Error('Test appears in multiple reports');
        results.set(id, { reportIndex, ...event.params.result });
      }
    });
    for (const [id, t] of tests) {
      const result = results.get(id);
      if (!result) throw new Error(`Missing result for ${id}`);
      if (result.status === 'skipped') continue;
      if (result.status !== 'passed' || !Number.isFinite(result.duration) || result.duration <= 0) throw new Error(`Failed or invalid result for ${id}`);
      const key = `${t.project}:${t.file}`;
      measurements.set(key, [...(measurements.get(key) ?? []), result.duration]);
    }
  }
  if (!measurements.size) throw new Error('No passing durations');
  const estimates = {};
  for (const [key, values] of [...measurements].sort(([a], [b]) => a.localeCompare(b))) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    const lower = Math.floor(median);
    // Match Python's round-to-even used for the original measured estimates.
    estimates[key] = median - lower === 0.5 && lower % 2 === 0 ? lower : Math.round(median);
  }
  return { source_runs: [...runs], unit: 'milliseconds per passing test, median by project and file', default_ms: defaultMs, estimates };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifestPath = resolve(process.argv[2] || '');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const root = dirname(manifestPath);
  const samples = manifest.runs.map(run => ({
    runId: run.run_id,
    plan: JSON.parse(readFileSync(resolve(root, run.plan), 'utf8')),
    reports: run.reports.map(file => readFileSync(resolve(root, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))),
  }));
  const result = estimateDurations(samples, manifest.default_ms ?? 40000);
  process.stdout.write(`// Advisory estimates from successful PR E2E reports; missing entries use the default.\nexport default ${JSON.stringify(result, null, 2)};\n`);
}
