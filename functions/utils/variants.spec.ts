import { describe, expect, it } from 'vitest';
import { VARIANTS, appIdOf, customContentTypeOf, variantByAppId } from './variants';

const APP_IDS = {
  lite: '8ad26115-211f-4216-971b-0540f606303d',
  full: 'd9e4002b-120b-426b-834b-402a4a5adce7',
  diagramly: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
  asyncapi: '49017727-af19-4ab6-8d5a-7d28108936b6',
} as const;

describe('variant registry lookups', () => {
  it.each(Object.entries(APP_IDS))('maps %s app id to its variant and back', (variant, appId) => {
    expect(variantByAppId(appId)?.variant).toBe(variant);
    expect(appIdOf(variant as keyof typeof APP_IDS)).toBe(appId);
  });

  it('returns undefined for an unknown app id', () => {
    expect(variantByAppId('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(variantByAppId('constructor')).toBeUndefined();
  });

  // Copied literally from magic-writeback.ts TYPES before the registry refactor (#876).
  it('reproduces the custom-content types magic-writeback used to hard-code', () => {
    const type = (appId: string) => customContentTypeOf(variantByAppId(appId)!);
    expect(type(APP_IDS.lite)).toBe('ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence');
    expect(type(APP_IDS.full)).toBe('ac:com.zenuml.confluence-addon:zenuml-content-sequence');
    expect(type(APP_IDS.diagramly)).toBe('ac:gptdock-confluence:gpt-custom-content-key');
  });

  it('accepts an explicit content key', () => {
    expect(customContentTypeOf(variantByAppId(APP_IDS.lite)!, 'zenuml-content-graph')).toBe(
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph',
    );
  });

  it('derives the module key magic-writeback used to pick by app id', () => {
    const moduleKey = (appId: string) => variantByAppId(appId)!.contentKeys[0];
    expect(moduleKey(APP_IDS.diagramly)).toBe('gpt-custom-content-key');
    expect(moduleKey(APP_IDS.lite)).toBe('zenuml-content-sequence');
    expect(moduleKey(APP_IDS.full)).toBe('zenuml-content-sequence');
  });

  it('holds exactly the four variants', () => {
    expect(VARIANTS.map((v) => v.variant)).toEqual(['lite', 'full', 'diagramly', 'asyncapi']);
  });
});
