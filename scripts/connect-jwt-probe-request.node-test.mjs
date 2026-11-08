import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProbeRequest, qshInput } from './connect-jwt-probe-request.mjs';

const type = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence';

test('sends the required type and body-format=raw, sorted and percent-encoded', () => {
  const req = buildProbeRequest({ pageId: '123', type });
  assert.equal(req.path, '/api/v2/pages/123/custom-content');
  assert.equal(
    req.query,
    'body-format=raw&type=ac%3Acom.zenuml.confluence-addon-lite%3Azenuml-content-sequence',
  );
});

test('the QSH covers the same query that goes on the URL', () => {
  const req = buildProbeRequest({ pageId: '123', type });
  assert.equal(
    qshInput('GET', req),
    `GET&/api/v2/pages/123/custom-content&${req.query}`,
  );
});

test('refuses to build a request without a type', () => {
  assert.throws(() => buildProbeRequest({ pageId: '123' }), /type is required/);
});
