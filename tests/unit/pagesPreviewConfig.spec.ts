import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMixpanelDisabled } from '../../functions/service/mixpanelService';
import { prepareMixpanelConfig } from '../../scripts/ci/mixpanel-staging-config.mjs';

type Section = { header: string; body: string[] };

function sections(config: string): Section[] {
  const result: Section[] = [];
  for (const raw of config.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      result.push({ header: line.replace(/\s+/g, ''), body: [] });
    } else if (result.length) {
      result[result.length - 1].body.push(line.replace(/\s+#.*$/, ''));
    }
  }
  return result;
}

function tables(config: string, environment: string): string[] {
  return sections(config)
    .filter(({ header }) => header.includes(`env.${environment}.`) && !header.endsWith('.vars]'))
    .map(({ header, body }) => `${header.replace(`env.${environment}.`, 'env.X.')}\n${body.join('\n')}`)
    .sort();
}

function vars(config: string, environment: string): Record<string, string> {
  const section = sections(config).find(({ header }) => header === `[env.${environment}.vars]`);
  return Object.fromEntries((section?.body ?? []).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
}

describe('staging Pages preview environment', () => {
  const config = readFileSync('wrangler-stg.toml', 'utf8');

  it('binds the same D1, KV, R2, Durable Object and AI resources as the production branch', () => {
    expect(tables(config, 'production').length).toBeGreaterThan(0);
    expect(tables(config, 'preview')).toEqual(tables(config, 'production'));
  });

  it('differs from the production branch only in the environment name, the expected Forge environment type and the OAuth callback host', () => {
    expect(vars(config, 'preview')).toEqual({
      ...vars(config, 'production'),
      ENVIRONMENT: '"preview"',
      EXPECTED_FORGE_ENVIRONMENT_TYPE: '"DEVELOPMENT"',
      // The PR slot serves this environment on its own host; see prSlotOAuthHost.spec.ts.
      ATLASSIAN_OAUTH_REDIRECT_URI: '"https://conf-stg-lite-pr.zenuml.com/agent-link/oauth/callback"',
    });
  });

  it('keeps Mixpanel disabled on the preview branch, where the Forge environment type is DEVELOPMENT', () => {
    expect(vars(config, 'preview').MIXPANEL_DISABLED).toBe('"true"');
    expect(isMixpanelDisabled({ MIXPANEL_DISABLED: 'true', EXPECTED_FORGE_ENVIRONMENT_TYPE: 'DEVELOPMENT' })).toBe(true);
    expect(isMixpanelDisabled({ MIXPANEL_DISABLED: 'true', EXPECTED_FORGE_ENVIRONMENT_TYPE: 'PRODUCTION' })).toBe(false);
    expect(isMixpanelDisabled({ MIXPANEL_DISABLED: 'true' })).toBe(false);
  });

  it('forces the disabled flag into the preview vars at deploy time, and accepts sources without that section', () => {
    const withPreview = '[vars]\n[env.production.vars]\n[env.preview.vars]\nENVIRONMENT = "preview"\n';
    expect(prepareMixpanelConfig(withPreview, 'stg').match(/^MIXPANEL_DISABLED = "true"$/gm)).toHaveLength(3);
    const withoutPreview = '[vars]\n[env.production.vars]\n';
    expect(prepareMixpanelConfig(withoutPreview, 'stg').match(/^MIXPANEL_DISABLED = "true"$/gm)).toHaveLength(2);
  });
});
