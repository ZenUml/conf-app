import { describe, expect, it } from 'vitest';
import { lexicalComparisonKey, readableNormalizedDisplay } from './participant-normalization.mjs';

const key = (label) => lexicalComparisonKey(label);

describe('lexicalComparisonKey', () => {
  it.each([
    [['Partner App', 'Partner-App', 'Partner_App', 'PartnerApp'], 'partner.app'],
    [['Mini App CLI', 'MiniAppCLI'], 'mini.app.cli'],
    [['Mobile App', 'MobileApp'], 'mobile.app'],
  ])('maps separator and case variants %j to %s', (variants, expected) => {
    for (const variant of variants) expect(key(variant)).toBe(expected);
  });

  it('strips emoji before keying', () => {
    expect(key('📱 Partner App')).toBe('partner.app');
  });

  it('keeps diacritics — letters are not transliterated', () => {
    expect(key('São Serviço')).toBe('são.serviço');
  });
});

describe('readableNormalizedDisplay', () => {
  it('case-folds and collapses whitespace without splitting camel case', () => {
    expect(readableNormalizedDisplay('Mini App CLI')).toBe('mini app cli');
    expect(readableNormalizedDisplay('MiniAppCLI')).toBe('miniappcli');
  });
});
