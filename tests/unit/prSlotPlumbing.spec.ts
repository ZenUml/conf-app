import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_BACKEND_URL,
  buildEnvOverride,
  resolveBackendUrl,
  resolveForgeEnvironment,
} from '../../scripts/ci/lite-deploy-prepare.mjs';

// The PR validation slot (Forge environment `pr`, site lite-dev, its own
// backend alias) is added as parameters first. Every default must equal the
// shared staging slot, so main, daily regression and today's PR runs are unchanged.
const deploy = readFileSync('.github/workflows/staging-deploy.yml', 'utf8');
const action = readFileSync('.github/actions/wrangler-publish/action.yml', 'utf8');
const prepare = readFileSync('scripts/ci/lite-deploy-prepare.mjs', 'utf8');
const prChild = readFileSync('.github/workflows/pr-agent-e2e-validation.yml', 'utf8');
const e2e = readFileSync('.github/workflows/e2e-test.yml', 'utf8');
const waitForE2e = readFileSync('scripts/ci/wait-for-e2e.mjs', 'utf8');
const agentLink = readFileSync('tests/e2e-tests/helpers/agentLink.ts', 'utf8');
const prValidation = readFileSync('.github/workflows/pr-validation.yml', 'utf8');

// One workflow/action step: from its `- name:` line to the next sibling `- ` item.
const step = (text: string, name: string) => {
  const start = text.indexOf(`- name: ${name}`);
  expect(start).toBeGreaterThan(-1);
  const lineStart = text.lastIndexOf('\n', start) + 1;
  const indent = ' '.repeat(start - lineStart);
  const end = text.indexOf(`\n${indent}- `, start + 1);
  return text.slice(start, end === -1 ? undefined : end);
};

describe('staging-deploy: dedicated slot inputs default to shared staging', () => {
  it.each([
    ['forge-environment', "default: 'staging'"],
    ['forge-site', "default: ''"],
    ['backend-url', "default: ''"],
  ])('declares %s on workflow_dispatch and workflow_call with default %s', (name, def) => {
    const declared = new RegExp(`\\n {6}${name}:\\n {8}required: false\\n {8}type: string\\n {8}${def}\\n`, 'g');
    expect(deploy.match(declared)).toHaveLength(2);
  });

  it('validates every new value in the resolve job and publishes them as outputs', () => {
    expect(deploy).toContain('IN_FORGE_ENVIRONMENT: ${{ inputs.forge-environment }}');
    expect(deploy).toContain('IN_FORGE_SITE: ${{ inputs.forge-site }}');
    expect(deploy).toContain('IN_BACKEND_URL: ${{ inputs.backend-url }}');
    expect(deploy).toContain('FORGE_ENVIRONMENT="${IN_FORGE_ENVIRONMENT:-staging}"');
    expect(deploy).toContain('^[a-z0-9_-]{1,32}$');
    expect(deploy).toContain('^[a-z0-9-]+\\.atlassian\\.net$');
    expect(deploy).toContain('^https://[a-z0-9.-]+\\.zenuml\\.com$');
    for (const out of ['forge-environment', 'forge-site', 'backend-url']) {
      expect(deploy).toContain(`${out}: \${{ steps.map.outputs.${out} }}`);
      expect(deploy).toContain(`echo "${out}=`);
    }
  });

  it('keeps the shared staging lock unless a dedicated environment is requested', () => {
    expect(deploy).toContain("github.workflow == 'Staging Deploy' && inputs.forge-environment != '' && inputs.forge-environment != 'staging' && 'conf-app-pr-slot'");
    expect(deploy).toContain("github.workflow == 'Staging Deploy' && 'conf-app-staging' || format(");
    expect(deploy).toContain("format('staging-inner-{0}-{1}'");
  });

  it('deploys with the shared-staging script by default and plain forge for another environment', () => {
    const run = step(deploy, 'Deploy to Forge Staging (Pages publish in parallel)');
    expect(run).toContain('elif [ "$FORGE_ENVIRONMENT" = staging ]; then\n              pnpm forge:deploy:${{ needs.resolve.outputs.variant }}:staging');
    expect(run).toContain('pnpm exec forge deploy -e "$FORGE_ENVIRONMENT" --non-interactive --verbose');
    expect(run).toContain('export BACKEND_API_BASE_URL="$BACKEND_URL"');
    expect(run).toContain('FORGE_ENVIRONMENT: ${{ needs.resolve.outputs.forge-environment }}');
    expect(run).toContain('BACKEND_URL: ${{ needs.resolve.outputs.backend-url }}');
  });

  it('writes Forge variables to the selected environment with the staging backend as default', () => {
    const run = step(deploy, 'Deploy to Forge Staging (Pages publish in parallel)');
    expect(run).not.toMatch(/-e staging/);
    expect(run.match(/forge variables set [^\n]* -e "\$FORGE_ENVIRONMENT"/g)!.length).toBeGreaterThanOrEqual(9);
    expect(run).toContain('forge variables set BACKEND_API_BASE_URL "${BACKEND_URL:-https://conf-stg-lite.zenuml.com}" -e "$FORGE_ENVIRONMENT"');
    const capture = step(deploy, 'Set PAGE_CAPTURE_SECRET in Forge Staging');
    expect(capture).not.toMatch(/-e staging/);
    expect(capture.match(/--encrypt -e "\$FORGE_ENVIRONMENT"/g)).toHaveLength(4);
    expect(capture).toContain('FORGE_ENVIRONMENT: ${{ needs.resolve.outputs.forge-environment }}');
  });

  it('keeps the shared-staging install commands and uses the named site/environment otherwise', () => {
    const install = step(deploy, 'Install Lite to lite-stg.atlassian.net');
    const [dedicated, shared] = install.split('            exit 0\n          fi\n');
    expect(shared).toContain('pnpm forge:upgrade:lite:staging || pnpm forge:install:lite:staging');
    expect(shared).toContain('pnpm forge:install:lite:staging || pnpm forge:upgrade:lite:staging');
    expect(dedicated).not.toMatch(/-e staging/);
    expect(dedicated).toContain('--site "${FORGE_SITE:-lite-stg.atlassian.net}"');
    expect(dedicated).toContain('-e "${FORGE_ENVIRONMENT:-staging}"');
    expect(dedicated).toContain('FORGE_SITE: ${{ needs.resolve.outputs.forge-site }}');
  });

  it('tolerates a failed install only for the shared staging site', () => {
    const install = step(deploy, 'Install Lite to lite-stg.atlassian.net');
    expect(install).toContain("continue-on-error: ${{ inputs.benchmark-sample == '' && needs.resolve.outputs.forge-site == '' }}");
  });

  it('hands the environment and backend to wrangler-publish', () => {
    const publish = step(deploy, 'Build and publish to Cloudflare');
    expect(publish).toContain('forge-environment: ${{ needs.resolve.outputs.forge-environment }}');
    expect(publish).toContain('backend-url: ${{ needs.resolve.outputs.backend-url }}');
  });
});

describe('wrangler-publish and lite-deploy-prepare', () => {
  it('declares forge-environment (staging) and backend-url (empty) inputs and validates them', () => {
    expect(action).toMatch(/forge-environment:\n {4}description: .*\n {4}required: false\n {4}default: 'staging'/);
    expect(action).toMatch(/backend-url:\n {4}description: .*\n {4}required: false\n {4}default: ''/);
    expect(action).toContain('^[a-z0-9_-]{1,32}$');
    expect(action).toContain('^https://[a-z0-9.-]+\\.zenuml\\.com$');
  });

  it('passes them to the candidate preparation script and the baseline build', () => {
    const prep = step(action, 'Prepare Lite staging in parallel');
    expect(prep).toContain('DEPLOY_FORGE_ENVIRONMENT: ${{ inputs.forge-environment }}');
    expect(prep).toContain('DEPLOY_BACKEND_URL: ${{ inputs.backend-url }}');
    expect(step(action, 'pnpm build')).toContain('VITE_REMOTE_BASE_URL_OVERRIDE: ${{ inputs.backend-url }}');
  });

  it('the script has no literal staging environment or backend left in its Forge commands', () => {
    expect(prepare).not.toMatch(/'-e', 'staging'/);
    expect(prepare).toContain("'-e', forgeEnvironment]");
    expect(prepare).toContain("'BACKEND_API_BASE_URL', backendUrl,");
    expect(prepare).toContain('DEPLOY_FORGE_ENVIRONMENT');
    expect(prepare).toContain('DEPLOY_BACKEND_URL');
  });

  it('resolves defaults to today\'s values', () => {
    expect(resolveForgeEnvironment(undefined)).toBe('staging');
    expect(resolveForgeEnvironment('')).toBe('staging');
    expect(resolveForgeEnvironment('pr')).toBe('pr');
    expect(resolveBackendUrl(undefined)).toBe('https://conf-stg-lite.zenuml.com');
    expect(DEFAULT_BACKEND_URL).toBe('https://conf-stg-lite.zenuml.com');
    expect(resolveBackendUrl('https://conf-stg-lite-pr.zenuml.com')).toBe('https://conf-stg-lite-pr.zenuml.com');
  });

  it.each(['PR', 'a b', 'x'.repeat(33), 'a;b', '$(id)'])('rejects Forge environment %s', (bad) => {
    expect(() => resolveForgeEnvironment(bad)).toThrow();
  });

  it.each(['http://x.zenuml.com', 'https://x.example.com', 'https://x.zenuml.com/p', 'https://x.zenuml.com:1', 'https://zenuml.com.evil.com'])('rejects backend URL %s', (bad) => {
    expect(() => resolveBackendUrl(bad)).toThrow();
  });

  it('bakes the override into the build only when a backend URL is supplied', () => {
    const env = { A: '1' };
    expect(buildEnvOverride(undefined, env)).toBe(env);
    expect(buildEnvOverride('', env)).toBe(env);
    expect(buildEnvOverride('https://conf-stg-lite-pr.zenuml.com', env)).toEqual({ A: '1', VITE_REMOTE_BASE_URL_OVERRIDE: 'https://conf-stg-lite-pr.zenuml.com' });
  });
});

describe('PR child workflow and its dispatcher', () => {
  it('defaults app and auth artifact to the shared Lite staging profile', () => {
    expect(prChild).toMatch(/\n {6}app:\n {8}required: false\n {8}type: string\n {8}default: 'zenuml-lite@stg'/);
    expect(prChild).toMatch(/\n {6}auth-artifact:\n {8}required: false\n {8}type: string\n {8}default: 'auth-state-pre-lite-stg'/);
    expect(prChild).toMatch(/\n {6}backend-url:\n {8}required: false\n {8}type: string\n {8}default: ''/);
  });

  it('uses the inputs instead of literals', () => {
    expect(prChild.match(/ {6}app: \$\{\{ inputs\.app \}\}/g)).toHaveLength(2);
    expect(prChild.match(/ {6}auth-artifact: \$\{\{ inputs\.auth-artifact \}\}/g)).toHaveLength(2);
    expect(prChild.match(/ {6}backend-url: \$\{\{ inputs\.backend-url \}\}/g)).toHaveLength(2);
    expect(prChild).not.toMatch(/app: zenuml-lite@stg/);
    expect(prChild).not.toMatch(/auth-artifact: auth-state-pre-lite-stg\n/);
  });

  it('e2e-test exports the backend to the tests only through an optional input', () => {
    expect(e2e).toMatch(/\n {6}backend-url:\n {8}type: string\n {8}default: ''/);
    expect(e2e.match(/E2E_BACKEND_BASE_URL: \$\{\{ inputs\.backend-url \}\}/g)).toHaveLength(2);
    expect(agentLink).toContain('process.env.E2E_BACKEND_BASE_URL');
    expect(agentLink).toContain("'https://conf-stg-lite.zenuml.com'");
  });

  it('wait-for-e2e forwards the slot overrides only from CHILD_* variables', () => {
    expect(waitForE2e).toContain('if (env.CHILD_APP) inputs.app = env.CHILD_APP;');
    expect(waitForE2e).toContain("if (env.CHILD_AUTH_ARTIFACT) inputs['auth-artifact'] = env.CHILD_AUTH_ARTIFACT;");
    expect(waitForE2e).toContain("if (env.CHILD_BACKEND_URL) inputs['backend-url'] = env.CHILD_BACKEND_URL;");
  });

  it('PR validation selects the PR slot end to end', () => {
    for (const value of ['forge-environment: pr', 'forge-site: lite-dev.atlassian.net', 'pages-branch: pr',
      'backend-url: https://conf-stg-lite-pr.zenuml.com', 'app: zenuml-lite@dev', 'CHILD_APP: zenuml-lite@dev',
      'CHILD_AUTH_ARTIFACT: auth-state-pre-lite-dev', 'CHILD_BACKEND_URL: https://conf-stg-lite-pr.zenuml.com']) {
      expect(prValidation).toContain(value);
    }
    // No shared-staging identity is left on the PR path.
    expect(prValidation).not.toContain('zenuml-lite@stg');
    expect(prValidation).not.toContain('group: conf-app-staging');
  });
});
