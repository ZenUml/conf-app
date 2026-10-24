import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareMixpanelConfig } from '../../scripts/ci/mixpanel-staging-config.mjs';

const config = `name="conf-stg"
[vars]
EXPECTED_FORGE_ENVIRONMENT_TYPE = "STAGING"
[env.production.vars]
EXPECTED_FORGE_ENVIRONMENT_TYPE = "STAGING"
[[env.production.d1_databases]]
binding = "DB"
`;

describe('Mixpanel deployment config', () => {
  it('adds the disabled flag to both staging Pages binding sections, including older app sources', () => {
    const result = prepareMixpanelConfig(config, 'stg');
    expect(result.match(/^MIXPANEL_DISABLED = "true"$/gm)).toHaveLength(2);
    expect(prepareMixpanelConfig(result, 'stg')).toBe(result);
  });

  it('leaves production Pages bindings enabled by default', () => {
    expect(prepareMixpanelConfig(config, 'prod')).toBe(config);
    expect(readFileSync('wrangler-prod.toml', 'utf8')).not.toContain('MIXPANEL_DISABLED');
  });

  it('fails if a staging config lacks either required binding section', () => {
    expect(() => prepareMixpanelConfig('[vars]\n', 'stg')).toThrow(/env.production.vars/);
  });

  it('wires both staging preparation paths and staging-scoped Forge variables', () => {
    expect(prepareMixpanelConfig(readFileSync('wrangler-stg.toml', 'utf8'), 'stg')
      .match(/^MIXPANEL_DISABLED = "true"$/gm)).toHaveLength(2);
    expect(readFileSync('.github/actions/wrangler-publish/action.yml', 'utf8'))
      .toContain('node scripts/ci/mixpanel-staging-config.mjs wrangler.toml "${{ inputs.environment }}"');
    expect(readFileSync('scripts/ci/lite-deploy-prepare.mjs', 'utf8'))
      .toContain('prepareMixpanelConfig(config, process.env.DEPLOY_ENVIRONMENT)');
    const stagingWorkflow = readFileSync('.github/workflows/staging-deploy.yml', 'utf8');
    expect(stagingWorkflow).toContain('mixpanel-staging-config.mjs; do');
    expect(stagingWorkflow).toContain('forge variables set MIXPANEL_DISABLED true -e staging');
    expect(stagingWorkflow.indexOf('pnpm forge:deploy:disable-analytics'))
      .toBeLessThan(stagingWorkflow.indexOf('forge variables set MIXPANEL_DISABLED true -e staging'));
  });
});
