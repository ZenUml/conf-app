import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesMacroKey } from './embed-macro-key.mjs';

test('the full macro key does not match the lite macro', () => {
  assert.equal(matchesMacroKey('zenuml-embed-macro-lite', 'zenuml-embed-macro'), false);
  assert.equal(matchesMacroKey('app-id/env-id/static/zenuml-embed-macro-lite', 'zenuml-embed-macro'), false);
});

test('matches the bare key and the Forge-prefixed key exactly', () => {
  assert.equal(matchesMacroKey('zenuml-embed-macro', 'zenuml-embed-macro'), true);
  assert.equal(matchesMacroKey('app-id/env-id/static/zenuml-embed-macro', 'zenuml-embed-macro'), true);
  assert.equal(matchesMacroKey('app-id/env-id/static/zenuml-embed-macro-lite', 'zenuml-embed-macro-lite'), true);
});

test('ignores missing keys', () => {
  assert.equal(matchesMacroKey(undefined, 'zenuml-embed-macro'), false);
  assert.equal(matchesMacroKey('', 'zenuml-embed-macro'), false);
});
