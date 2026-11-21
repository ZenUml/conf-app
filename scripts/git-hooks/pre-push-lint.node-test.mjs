import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterLintable } from './pre-push-lint.mjs';

const all = () => true;

test('keeps lintable extensions inside linted directories', () => {
  const files = ['src/a.ts', 'src/b.vue', 'functions/c.js', 'scripts/d.mjs', 'scripts/e.cjs', 'tests/unit/f.tsx'];
  assert.deepEqual(filterLintable(files, all), files);
});

test('drops other extensions', () => {
  assert.deepEqual(filterLintable(['src/a.json', 'src/b.css', 'src/c.md'], all), []);
});

test('drops files outside the linted directories', () => {
  assert.deepEqual(filterLintable(['tests/e2e-tests/a.ts', 'docs/b.js', 'a.ts', 'srcx/a.ts'], all), []);
});

test('drops files that no longer exist', () => {
  assert.deepEqual(filterLintable(['src/a.ts', 'src/gone.ts'], (f) => f !== 'src/gone.ts'), ['src/a.ts']);
});
