import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AdsIcon from './AdsIcon.vue';
import { ADS_ICONS } from './adsIcons';

// The design's own SVG export, kept in the repo so the paths below can be
// diffed against their source instead of eyeballed against a screenshot.
const frameSvg = readFileSync(
  resolve(process.cwd(), 'src/components/ExportModal/__design__/icons-frame.svg'),
  'utf-8',
);

const expectedGlyphs = [
  'arrow', 'text', 'comment', 'lock', 'refresh', 'cross', 'download',
  'copy', 'trash', 'add', 'info', 'check', 'select', 'rectangle', 'stamp',
] as const;

// The nine toolbar glyphs are pasted verbatim from the Figma export, so they
// keep that file's coordinate space instead of a shared 24x24 box.
const figmaSourced = ['arrow', 'text', 'comment', 'cross', 'download', 'copy', 'select', 'rectangle', 'stamp'] as const;

describe('AdsIcon', () => {
  it('keeps the existing glyph names and exposes annotation tools', () => {
    expect(Object.keys(ADS_ICONS)).toEqual(expectedGlyphs);
  });

  it('renders one currentColor outline path in the glyph\'s own coordinate space', () => {
    const wrapper = mount(AdsIcon, { props: { glyph: 'stamp' } });
    const svg = wrapper.get('svg');

    expect(svg.attributes()).toMatchObject({
      width: '16',
      height: '16',
      viewBox: ADS_ICONS.stamp.viewBox,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': String(ADS_ICONS.stamp.strokeWidth),
    });
    expect(svg.get('path').attributes('d')).toBe(ADS_ICONS.stamp.d);
  });

  it('does not retain filled glyph payloads', () => {
    for (const glyph of expectedGlyphs) {
      expect(ADS_ICONS[glyph].d).not.toMatch(/fill\s*=/);
    }
  });

  it('gives the Figma-sourced glyphs the export\'s own 16-unit window and 1px stroke', () => {
    for (const glyph of figmaSourced) {
      expect(ADS_ICONS[glyph].strokeWidth).toBe(1);
      expect(ADS_ICONS[glyph].viewBox).toMatch(/^\d+ 100 16 16$/);
    }
  });

  // Guards the one failure mode a screenshot cannot catch: a path quietly
  // hand-edited or redrawn so it no longer is what the designer exported.
  it('quotes every Figma-sourced path verbatim from the stored frame export', () => {
    for (const glyph of figmaSourced) {
      expect(frameSvg).toContain(`d="${ADS_ICONS[glyph].d}"`);
    }
  });
});
