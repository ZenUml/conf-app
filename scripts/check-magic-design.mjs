/** Bounded source check for the Magic controls in GenericViewer.vue.
 * DESIGN.md values are the contract; this does not replace a browser review. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const aliases = {
  '--magic-primary': '--color-blue-600',
  '--magic-primary-hover': '--color-blue-700',
  '--magic-surface': '--bg1',
  '--magic-subtle': '--gray-50',
  '--magic-hover': '--gray-100',
  '--magic-border': '--gray-200',
  '--magic-border-strong': '--gray-300',
  '--magic-text': '--gray-700',
  '--magic-text-soft': '--gray-600',
  '--magic-on-primary': '--fg-on-primary',
  '--magic-danger': '--color-danger',
  '--magic-radius': '--radius-md',
};

function rule(css, selector) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, name]) => name.trim() === selector)?.[2] ?? null;
}

function documented(design, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return design.match(new RegExp('\\|\\s*`' + escaped + '`\\s*\\|\\s*`?([^`|]+)`?\\s*\\|'))?.[1]?.trim() ?? null;
}

export function checkMagicDesign(design, viewer) {
  const errors = [];
  const style = (viewer.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const frame = rule(style, '.viewer-frame');
  if (!frame) return ['Missing scoped .viewer-frame CSS'];

  for (const [alias, base] of Object.entries(aliases)) {
    const expected = documented(design, base);
    if (!expected) { errors.push(`DESIGN.md has no value for ${base}`); continue; }
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const actual = frame.match(new RegExp(escaped + '\\s*:\\s*var\\(\\s*([^,]+),\\s*([^)]+)\\)\\s*;'));
    if (!actual || actual[1].trim() !== base || actual[2].trim().toLowerCase() !== expected.toLowerCase()) {
      errors.push(`${alias} must resolve ${base} with DESIGN.md fallback ${expected}`);
    }
  }

  const magicRules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => /\.(?:magic-|viewer-version-|viewer-magic-icon)/.test(selector));
  if (magicRules.length < 10) errors.push('Expected Magic control CSS rules are missing');
  for (const [, selector, body] of magicRules) {
    if (/#[\da-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/i.test(body)) errors.push(`Raw color in ${selector.trim()}`);
    if (/border-radius\s*:\s*\d+(?:\.\d+)?px/i.test(body)) errors.push(`Raw radius in ${selector.trim()}`);
    for (const [, alias] of body.matchAll(/var\(\s*(--magic-[\w-]+)/g)) {
      if (!(alias in aliases)) errors.push(`Undeclared ${alias} in ${selector.trim()}`);
    }
  }

  const switchCss = rule(style, '.viewer-version-switch') ?? '';
  const feedbackCss = rule(style, '.magic-layout-feedback button') ?? '';
  const selectedSwitch = rule(style, '.viewer-version-option--selected, .viewer-version-option--selected:hover') ?? '';
  const selectedFeedback = rule(style, '.magic-layout-feedback button[aria-pressed="true"]') ?? '';
  if (!/border-radius\s*:\s*var\(--magic-radius\)/.test(switchCss)) errors.push('Version switch must use the documented 6px radius');
  if (!/border-radius\s*:\s*var\(--magic-radius\)/.test(feedbackCss)) errors.push('Feedback buttons must use the documented 6px radius');
  for (const [name, css] of [['version switch', selectedSwitch], ['layout feedback', selectedFeedback]]) {
    if (!/background\s*:\s*var\(--magic-primary\)/.test(css) || !/color\s*:\s*var\(--magic-on-primary\)/.test(css)) {
      errors.push(`Selected ${name} must use blue-600 with white text`);
    }
  }
  const iconCss = rule(style, '.viewer-magic-icon') ?? '';
  if (!/width\s*:\s*16px/.test(iconCss) || !/height\s*:\s*16px/.test(iconCss)) errors.push('Magic wand must be 16px square');
  const wand = viewer.match(/<svg[^>]*class="viewer-magic-icon"[^>]*>/)?.[0] ?? '';
  if (!/stroke="currentColor"/.test(wand) || !/stroke-width="1\.5"/.test(wand) || !/aria-hidden="true"/.test(wand)) {
    errors.push('Magic wand must inherit color, use a 1.5 stroke, and be decorative');
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const design = readFileSync(resolve(root, 'DESIGN.md'), 'utf8');
  const viewer = readFileSync(resolve(root, 'src/components/Viewer/GenericViewer.vue'), 'utf8');
  const errors = checkMagicDesign(design, viewer);
  if (errors.length) { errors.forEach(error => console.error(`Magic design: ${error}`)); process.exitCode = 1; }
  else console.log('Magic design: documented token fallbacks, scoped colors/radii, and wand dimensions pass');
}
