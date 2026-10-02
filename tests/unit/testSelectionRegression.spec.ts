import { describe, expect, it } from 'vitest';
import { aggregateRegression } from '../../scripts/test-selection/regression-results.mjs';

const run = { id: 42, run_attempt: 2, html_url: 'https://github.com/ZenUml/conf-app/actions/runs/42', conclusion: 'success' };
const jobs = ['Lite', 'Full', 'Diagramly', 'AsyncAPI'].flatMap(variant => ['deploy', 'verify version', 'E2E tests'].map(stage => ({ name: `${variant} / ${stage}`, status: 'completed', conclusion: 'success', html_url: `https://example.com/${stage.replaceAll(' ', '-')}` })));
describe('daily regression aggregation', () => {
  it('uses immutable target SHA and requires all stages for every variant', () => {
    const result = aggregateRegression(run, jobs, { sha: 'target123' });
    expect(result.sha).toBe('target123');
    expect(result.attempt).toBe(2);
    expect(result.variants).toHaveLength(4);
    expect(result.variants.every(v => v.tests === 'success' && !v.failures.length)).toBe(true);
  });
  it('marks missing and skipped test stages as lost coverage', () => {
    const result = aggregateRegression(run, jobs.filter(j => !j.name.startsWith('Full / E2E')), { sha: 'target' });
    expect(result.variants[1].tests).toBe('skipped');
    expect(result.variants[1].failures[0].name).toContain('Missing');
    const skipped = jobs.map(j => j.name.startsWith('Lite / E2E') ? { ...j, conclusion: 'skipped' } : j);
    expect(aggregateRegression(run, skipped, { sha: 'target' }).variants[0].tests).toBe('skipped');
  });
  it('aggregates failures, timeouts and cancellation while preserving other variants', () => {
    const broken = jobs.map(j => j.name === 'Lite / deploy' ? { ...j, conclusion: 'failure' } : j.name === 'Full / verify version' ? { ...j, conclusion: 'timed_out' } : j.name === 'AsyncAPI / E2E tests' ? { ...j, conclusion: 'cancelled' } : j);
    const result = aggregateRegression(run, broken, { sha: 'target' });
    expect(result.variants.map(v => [v.deployment, v.version, v.tests])).toEqual([['failure', 'success', 'success'], ['success', 'failure', 'success'], ['success', 'success', 'success'], ['success', 'success', 'cancelled']]);
    expect(result.variants[1].failures[0].name).toContain('timed_out');
  });
  it('never infers success from empty or incomplete jobs or only setup E2E jobs', () => {
    expect(aggregateRegression({ ...run, conclusion: 'cancelled' }, [], { sha: 'target' }).variants.every(v => v.tests === 'cancelled')).toBe(true);
    const pending = jobs.map(j => j.name.includes('E2E') ? { ...j, status: 'in_progress', conclusion: null } : j);
    expect(aggregateRegression(run, pending, { sha: 'target' }).variants.every(v => v.tests === 'failure')).toBe(true);
    const setup = jobs.map(j => ({ ...j, name: j.name.replace('E2E tests', 'E2E setup') }));
    expect(aggregateRegression(run, setup, { sha: 'target' }).variants.every(v => v.tests === 'skipped')).toBe(true);
  });
  it('rejects missing target evidence rather than substituting workflow head', () => {
    expect(() => aggregateRegression({ ...run, head_sha: 'wrong' }, jobs, {})).toThrow('target SHA');
  });
});
