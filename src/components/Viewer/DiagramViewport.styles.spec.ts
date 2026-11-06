import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@vue/compiler-sfc';
import { describe, it, expect } from 'vitest';

/**
 * jsdom does not apply scoped SFC CSS, so a mounted-component spec cannot see the
 * fill. Read the stylesheet itself instead.
 */
function declarationsOf(selector: string): Map<string, string> {
  const source = readFileSync(resolve(__dirname, 'DiagramViewport.vue'), 'utf8');
  const { descriptor } = parse(source);
  const css = descriptor.styles.map((s) => s.content).join('\n');
  const declarations = new Map<string, string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = rule.exec(css); match; match = rule.exec(css)) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return declarations;
}

describe('DiagramViewport fullscreen styles (#872)', () => {
  const fullscreen = declarationsOf('.diagram-viewport--fullscreen');

  it('still sizes the fullscreen viewport', () => {
    expect(fullscreen.get('height')).toBeTruthy();
  });

  it.each(['background', 'background-color', 'background-image', 'border-radius'])(
    'declares no %s, so the viewer canvas stays one continuous surface',
    (property) => {
      expect(fullscreen.has(property)).toBe(false);
    },
  );
});
