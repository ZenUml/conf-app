import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AdsIcon from './AdsIcon.vue';
import { ADS_ICONS } from './adsIcons';

const expectedGlyphs = [
  'arrow', 'text', 'comment', 'lock', 'refresh', 'cross', 'download',
  'copy', 'trash', 'add', 'info', 'check', 'select', 'rectangle', 'stamp',
] as const;

describe('AdsIcon', () => {
  it('keeps the existing glyph names and exposes annotation tools', () => {
    expect(Object.keys(ADS_ICONS)).toEqual(expectedGlyphs);
  });

  it('renders the shared 24px, 1.5px currentColor outline treatment', () => {
    const wrapper = mount(AdsIcon, { props: { glyph: 'stamp' } });
    const svg = wrapper.get('svg');

    expect(svg.attributes()).toMatchObject({
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
    });
    expect(svg.findAll('path')).toHaveLength(2);
  });

  it('does not retain filled glyph payloads', () => {
    for (const glyph of expectedGlyphs) {
      expect(ADS_ICONS[glyph]).not.toMatch(/fill\s*=/);
    }
  });
});
