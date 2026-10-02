import { describe, expect, it } from 'vitest';
import { aggregateRegression } from '../../scripts/test-selection/regression-results.mjs';
const run = { id: 42, run_attempt: 2, html_url: 'https://example.com/run', conclusion: 'success' };
const job = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion, html_url: 'https://example.com/job' });
const jobs = ['Lite', 'Full', 'Diagramly', 'AsyncAPI'].flatMap(variant => [
  job(`${variant} / deploy / Deploy`), job(`${variant} / verify version`),
  ...['E2E full live regression', ...(variant === 'AsyncAPI' ? [] : ['E2E full render regression'])].flatMap(suite => ['plan concrete tests', 'shard 1/2', 'shard 2/2', 'aggregate concrete evidence', 'auth / auth bootstrap', 'merge shard reports'].map(stage => job(`${variant} / ${suite} / ${stage}`, stage.startsWith('auth') || stage.startsWith('merge') ? 'skipped' : 'success'))),
  ...(variant === 'AsyncAPI' ? [job(`${variant} / E2E full render regression`, 'skipped')] : []),
]);
describe('daily regression aggregation', () => {
  it('requires concrete live/render evidence and ignores expected auth/report skips', () => {
    const result = aggregateRegression(run, jobs, { sha: 'target123' });
    expect(result.sha).toBe('target123');
    expect(result.attempt).toBe(2);
    expect(result.variants.every(v => v.tests === 'success' && !v.failures.length)).toBe(true);
  });
  it('marks missing execution, planning or aggregate coverage as lost coverage', () => {
    for (const stage of ['shard', 'aggregate concrete evidence', 'plan concrete tests']) {
      const result = aggregateRegression(run, jobs.filter(j => !(j.name.startsWith('Full / E2E full render') && j.name.includes(stage))), { sha: 'target' });
      expect(result.variants[1].tests).toBe('skipped');
      expect(result.variants[1].failures[0].name).toContain('Missing');
    }
  });
  it('detects an absent shard despite remaining successful shards and aggregate', () => {
    const result = aggregateRegression(run, jobs.filter(j => j.name !== 'Lite / E2E full live regression / shard 2/2'), { sha: 'target' });
    expect(result.variants[0].tests).toBe('failure');
    expect(result.variants[0].failures[0].name).toContain('Incomplete shard');
  });
  it('preserves timeouts, skipped/cancelled execution and other variant success', () => {
    for (const conclusion of ['timed_out', 'cancelled', 'skipped']) {
      const broken = jobs.map(j => j.name === 'Lite / E2E full live regression / shard 1/2' ? { ...j, conclusion } : j);
      const result = aggregateRegression(run, broken, { sha: 'target' });
      expect(result.variants[0].tests).toBe(conclusion === 'timed_out' ? 'failure' : conclusion);
      expect(result.variants[0].failures[0].name).toContain(conclusion);
      expect(result.variants[1].tests).toBe('success');
    }
  });
  it('never infers success from no jobs or incomplete execution', () => {
    expect(aggregateRegression({ ...run, conclusion: 'cancelled' }, [], { sha: 'target' }).variants.every(v => v.tests === 'cancelled')).toBe(true);
    const pending = jobs.map(j => j.name.includes('shard 1/2') ? { ...j, status: 'in_progress', conclusion: null } : j);
    expect(aggregateRegression(run, pending, { sha: 'target' }).variants.every(v => v.tests === 'failure')).toBe(true);
  });
  it('rejects missing target evidence rather than substituting workflow head', () => {
    expect(() => aggregateRegression({ ...run, head_sha: 'wrong' }, jobs, {})).toThrow('target SHA');
  });
});
