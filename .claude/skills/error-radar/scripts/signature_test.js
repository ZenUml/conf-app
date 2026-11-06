// Run: node --test .claude/skills/error-radar/scripts/signature_test.js
// Named *_test.js, not *.test.js: the root Vitest run collects every
// *.test.js in the repo and fails on a file written for node:test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { radarIsErrorEvent, radarNormalize, radarSignature } = require('./signature.js');

test('ids in a duplicate-filename message collapse to one signature', () => {
  const a = 'Confluence attachment API returned 400: com.atlassian.confluence.api.service.exceptions.api.BadRequestException: Cannot add a new attachment with same file name as an existing attachment: zenuml-59512';
  const b = a.replace('59512', '88234');
  assert.equal(radarNormalize(a), radarNormalize(b));
  assert.equal(radarNormalize(a), 'Confluence attachment API returned <n>: BadRequestException: Cannot add a new attachment with same file name as an existing attachment: zenuml-<n>');
});

test('ContentId and uuid placeholders', () => {
  assert.equal(
    radarNormalize('User not permitted to create attachments for content: ContentId{id=3748004885}'),
    'User not permitted to create attachments for content: ContentId{id=<n>}',
  );
  assert.equal(radarNormalize('app 49017727-af19-4ab6-8d5a-7d28108936b6 failed'), 'app <uuid> failed');
});

test('HTML bodies with different markup are one signature', () => {
  const a = 'Confluence attachment API returned 503: <!doctype html>\n<html>\n<head><meta charset="utf-8">';
  const b = 'Confluence attachment API returned 503: <!doctype html><html lang="en"><title>x</title>';
  assert.equal(radarNormalize(a), radarNormalize(b));
  assert.equal(radarNormalize(a), 'Confluence attachment API returned <n>: <html…>');
});

test('long messages are truncated and missing ones are empty', () => {
  assert.ok(radarNormalize('x'.repeat(500)).length <= 161);
  assert.equal(radarNormalize(undefined), '');
  assert.equal(radarNormalize(null), '');
});

test('signature joins the identifying fields with placeholders for missing ones', () => {
  assert.equal(radarSignature('load_custom_content_v2_missing', {}), 'load_custom_content_v2_missing | - | - | - | -');
  // event_label stands in for error_message on legacy events; ids collapse.
  assert.equal(radarSignature('convert_to_png', { event_label: 'toPng_timeout' }), 'convert_to_png | - | - | - | toPng_timeout');
  assert.equal(radarSignature('load_custom_content_v2_missing', { event_label: '3748004885' }), 'load_custom_content_v2_missing | - | - | - | <n>');
  assert.equal(
    radarSignature('attachment_upload_failed', { error_name: 'AttachmentUploadHttpError', http_status: 401, confluence_error_class: 'none', error_message: 'returned 401: missing x-forge-oauth-user header' }),
    'attachment_upload_failed | AttachmentUploadHttpError | 401 | none | returned <n>: missing x-forge-oauth-user header',
  );
});

test('error-event selection', () => {
  assert.equal(radarIsErrorEvent('attachment_upload_failed', {}), true);
  assert.equal(radarIsErrorEvent('client_unhandled_error', {}), true);
  assert.equal(radarIsErrorEvent('load_custom_content_v2_missing', {}), true);
  assert.equal(radarIsErrorEvent('customcontent_orphan_observed', {}), true);
  assert.equal(radarIsErrorEvent('load_custom_content', { event_category: 'error' }), true);
  // 'warning' alone is a probe (duplication_detect), not a failure.
  assert.equal(radarIsErrorEvent('duplication_detect', { event_category: 'warning' }), false);
  // Mid-name "_failed_" is a success/action event, not an error.
  assert.equal(radarIsErrorEvent('load_failed_retry_clicked', {}), false);
  assert.equal(radarIsErrorEvent('macro_viewed', {}), false);
  // The create_attachment<type> echo of attachment_upload_failed is skipped.
  assert.equal(radarIsErrorEvent('create_attachmentmermaid', { event_category: 'error' }), false);
  // Other products in the shared project are out of scope.
  assert.equal(radarIsErrorEvent('pass_failed', { product: 'passetta' }), false);
  assert.equal(radarIsErrorEvent('$mp_web_page_view', {}), false);
});

test('HTTP status codes after status/code/HTTP survive, other numbers do not', () => {
  assert.equal(radarNormalize('{"status":403}'), '{"status":403}');
  assert.notEqual(radarNormalize('{"status":403}'), radarNormalize('{"status":500}'));
  assert.equal(radarNormalize('HTTP 429 after 3 retries'), 'HTTP 429 after <n> retries');
  assert.equal(radarNormalize('status code: 404 for page 123'), 'status code: 404 for page <n>');
  // Not a status: too long, or out of the 1xx-5xx range.
  assert.equal(radarNormalize('status 4031'), 'status <n>');
  assert.equal(radarNormalize('code 999'), 'code <n>');
});
