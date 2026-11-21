import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variantForApp } from '../app-variant.mjs';

test('any environment of a Lite or Full profile maps to its variant', () => {
  assert.equal(variantForApp('zenuml-lite@stg'), 'lite');
  assert.equal(variantForApp('zenuml-lite@dev'), 'lite');
  assert.equal(variantForApp('zenuml-full@stg'), 'full');
  assert.equal(variantForApp('zenuml-full@dev'), 'full');
});

test('other profiles keep the name before the @, and a missing profile stays undefined', () => {
  assert.equal(variantForApp('zenuml-dia@stg'), 'zenuml-dia');
  assert.equal(variantForApp('zenuml-lite'), 'zenuml-lite');
  assert.equal(variantForApp(undefined), undefined);
});
