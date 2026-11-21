import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  pagesSecretCommand,
  resolvePagesBranch,
} from '../../scripts/ci/lite-deploy-prepare.mjs';

const action = readFileSync('.github/actions/wrangler-publish/action.yml', 'utf8');
const workflow = readFileSync('.github/workflows/staging-deploy.yml', 'utf8');
const prepare = readFileSync('scripts/ci/lite-deploy-prepare.mjs', 'utf8');

const step = (text: string, name: string) => {
  const start = text.indexOf(`- name: ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = text.indexOf('\n    - name:', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

describe('Pages deploy branch: lite-deploy-prepare helpers', () => {
  it('defaults to production and adds no --env flag', () => {
    expect(resolvePagesBranch(undefined)).toBe('production');
    expect(resolvePagesBranch('')).toBe('production');
    expect(pagesSecretCommand('put', 'SENTRY_DSN', 'conf-stg-lite', 'production')).toEqual([
      'wrangler', 'pages', 'secret', 'put', 'SENTRY_DSN', '--project-name=conf-stg-lite',
    ]);
  });

  it('adds --env preview for a non-production branch', () => {
    expect(pagesSecretCommand('delete', 'X', 'conf-stg-lite', 'pr')).toEqual([
      'wrangler', 'pages', 'secret', 'delete', 'X', '--project-name=conf-stg-lite', '--env', 'preview',
    ]);
  });

  it('accepts only [a-z0-9-]{1,28}', () => {
    expect(resolvePagesBranch('pr')).toBe('pr');
    expect(resolvePagesBranch('a'.repeat(28))).toBe('a'.repeat(28));
    for (const bad of ['a'.repeat(29), 'PR', 'a b', 'a;b', '$(x)', 'a/b', 'a_b']) {
      expect(() => resolvePagesBranch(bad)).toThrow();
    }
  });

  it('uses DEPLOY_PAGES_BRANCH in every secret command and leaves D1 migrations on production', () => {
    expect(prepare).toContain('DEPLOY_PAGES_BRANCH');
    expect(prepare).not.toMatch(/'pages', 'secret', '(put|delete)'/);
    expect(prepare).toContain("'migrations', 'apply', 'DB', '--remote', '--env', 'production'");
    expect(prepare).toContain('\\[env\\.preview\\.vars\\]');
  });
});

describe('Pages deploy branch: wrangler-publish action', () => {
  it('declares pages-branch with default production', () => {
    expect(action).toMatch(/pages-branch:\n {4}description: .*\n {4}required: false\n {4}default: 'production'/);
  });

  it('publishes to the requested branch', () => {
    const publish = step(action, 'Publish');
    expect(publish).toContain('--branch "$PAGES_BRANCH"');
    expect(publish).toContain('PAGES_BRANCH: ${{ inputs.pages-branch }}');
    expect(publish).not.toContain('--branch production');
  });

  it('adds --env preview to secret commands only for a non-production branch', () => {
    const sync = step(action, 'Sync runtime env vars to Cloudflare Pages');
    expect(sync).toContain('PAGES_BRANCH: ${{ inputs.pages-branch }}');
    expect(sync).toContain('ENV_ARGS=(--env preview)');
    expect(sync.match(/wrangler pages secret (put|delete)/g)).toHaveLength(4);
    for (const line of sync.split('\n').filter(l => /wrangler pages secret/.test(l))) {
      expect(line).toContain('"${ENV_ARGS[@]}"');
    }
    // Production default keeps the original command text before the added args.
    expect(sync).toContain('npx wrangler pages secret put MIXPANEL_TOKEN --project-name=${{ inputs.project }} "${ENV_ARGS[@]}"');
  });

  it('injects PAGE_CAPTURE_ALLOWED_DOMAINS under [env.preview.vars] as well', () => {
    const prep = step(action, 'Prepare wrangler config');
    expect(prep).toContain('/^\\[env\\.preview\\.vars\\]$/a PAGE_CAPTURE_ALLOWED_DOMAINS');
    expect(prep).toContain('/^\\[env\\.production\\.vars\\]$/a PAGE_CAPTURE_ALLOWED_DOMAINS');
  });

  it('passes the branch to the candidate preparation script and keeps D1 on production', () => {
    expect(step(action, 'Prepare Lite staging in parallel')).toContain('DEPLOY_PAGES_BRANCH: ${{ inputs.pages-branch }}');
    expect(step(action, 'Run D1 Migrations')).toContain('--env production');
  });

  it('validates the branch name', () => {
    expect(action).toContain('^[a-z0-9-]{1,28}$');
  });
});

describe('Pages deploy branch: staging-deploy workflow', () => {
  const declared = /pages-branch:\n {8}required: false\n {8}type: string\n {8}default: 'production'/g;

  it('offers pages-branch on workflow_dispatch and workflow_call', () => {
    expect(workflow.match(declared)).toHaveLength(2);
  });

  it('normalises and validates it in the resolve job', () => {
    expect(workflow).toContain('pages-branch: ${{ steps.map.outputs.pages-branch }}');
    expect(workflow).toContain('IN_PAGES_BRANCH: ${{ inputs.pages-branch }}');
    expect(workflow).toContain('echo "pages-branch=$PAGES_BRANCH"');
    expect(workflow).toContain('^[a-z0-9-]{1,28}$');
  });

  it('passes it to wrangler-publish and the direct pages deploy', () => {
    expect(workflow).toContain('pages-branch: ${{ needs.resolve.outputs.pages-branch }}');
    expect(workflow).toContain('PAGES_BRANCH: ${{ needs.resolve.outputs.pages-branch }}');
    expect(workflow).toContain('wrangler pages deploy dist --branch "$PAGES_BRANCH"');
    expect(workflow).not.toContain('--branch production');
  });
});
