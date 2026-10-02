import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkMagicDesign } from './check-magic-design.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const design = readFileSync(resolve(root, 'DESIGN.md'), 'utf8');
const viewer = readFileSync(resolve(root, 'src/components/Viewer/GenericViewer.vue'), 'utf8');

test('current Magic controls follow documented token fallbacks and dimensions', () => {
  assert.deepEqual(checkMagicDesign(design, viewer), []);
});

test('rejects an undocumented raw color or radius in Magic rules', () => {
  const rawColor = viewer.replace('background: var(--magic-primary);', 'background: #0369a1;');
  assert.match(checkMagicDesign(design, rawColor).join('\n'), /Raw color/);
  const rawRadius = viewer.replace('border-radius: var(--magic-radius);', 'border-radius: 7px;');
  assert.match(checkMagicDesign(design, rawRadius).join('\n'), /Raw radius/);
});

test('rejects stale token fallbacks and a nonstandard wand', () => {
  const wrongBlue = viewer.replace('--magic-primary: var(--color-blue-600, #2563EB);', '--magic-primary: var(--color-blue-600, #0369a1);');
  assert.match(checkMagicDesign(design, wrongBlue).join('\n'), /--magic-primary must resolve/);
  const smallWand = viewer.replace('.viewer-magic-icon { width: 16px; height: 16px;', '.viewer-magic-icon { width: 15px; height: 16px;');
  assert.match(checkMagicDesign(design, smallWand).join('\n'), /16px square/);
  const heavyWand = viewer.replace('class="viewer-magic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"', 'class="viewer-magic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"');
  assert.match(checkMagicDesign(design, heavyWand).join('\n'), /1\.5 stroke/);
});

test('rejects a selected state that silently changes to a neutral token', () => {
  const neutralSelected = viewer.replace(
    '.viewer-version-option--selected, .viewer-version-option--selected:hover { background: var(--magic-primary);',
    '.viewer-version-option--selected, .viewer-version-option--selected:hover { background: var(--magic-hover);',
  );
  assert.match(checkMagicDesign(design, neutralSelected).join('\n'), /Selected version switch must use blue-600/);
});
