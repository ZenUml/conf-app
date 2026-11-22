import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

// agent-link refuses a request whose host differs from the OAuth callback host
// (functions/agent-link/oauth/appConfig.ts, OAuthRedirectHostMismatchError).
// PR validation serves the Pages preview environment on its own host, so the
// preview callback must use that host or every agent-link call there is a 500.
function varIn(section: string, name: string): string {
  const lines = readFileSync('wrangler-stg.toml', 'utf8').split('\n');
  const start = lines.findIndex(line => line.trim() === `[${section}]`);
  expect(start, `[${section}] exists`).toBeGreaterThanOrEqual(0);
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('[')) break;
    const match = line.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`));
    if (match) return match[1];
  }
  throw new Error(`${name} not in [${section}]`);
}

describe('PR slot agent-link OAuth host', () => {
  it('preview callback host is the PR slot backend host', () => {
    const workflow = load(readFileSync('.github/workflows/pr-validation.yml', 'utf8')) as any;
    const backend = workflow.jobs['staging-lite'].with['backend-url'];
    expect(new URL(varIn('env.preview.vars', 'ATLASSIAN_OAUTH_REDIRECT_URI')).origin).toBe(new URL(backend).origin);
    expect(new URL(varIn('env.production.vars', 'ATLASSIAN_OAUTH_REDIRECT_URI')).origin).toBe('https://conf-stg-lite.zenuml.com');
  });
});
