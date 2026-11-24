import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const workflows = ['main-staging-validation', 'daily-regression', 'lite-deploy-benchmark'];
const script = 'scripts/ci/staging-d1-migrations.sh';

describe('shared staging D1 migrations job', () => {
  it.each(workflows)('%s applies migrations without installing the dependency tree', (name) => {
    const job = (load(readFileSync(`.github/workflows/${name}.yml`, 'utf8')) as any).jobs.migrations;
    expect(job.name).toBe('Shared staging D1 migrations');
    const runs = job.steps.map((step: any) => step.run ?? '').join('\n');
    const uses = job.steps.map((step: any) => step.uses ?? '');
    // The job needs only wrangler. A full install took 19 s of a 33 s job
    // that every staging deploy waits for.
    expect(runs).not.toMatch(/pnpm install/);
    expect(uses.filter((value: string) => value.startsWith('pnpm/action-setup'))).toEqual([]);
    expect(runs).toContain(`bash ${script}`);
    const apply = job.steps.find((step: any) => (step.run ?? '').includes(script));
    expect(Object.keys(apply.env).sort()).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
  });

  it('runs the wrangler version the lockfile pins, not a floating range', () => {
    const printed = execFileSync('bash', [script, '--print-version'], { encoding: 'utf8' }).trim();
    const installed = JSON.parse(readFileSync('node_modules/wrangler/package.json', 'utf8')).version;
    expect(printed).toBe(installed);
    const text = readFileSync(script, 'utf8');
    expect(text).toContain('npx --yes "wrangler@$VERSION" d1 migrations apply DB --remote --env production');
    expect(text).toContain('cp wrangler-stg.toml wrangler.toml');
  });
});
