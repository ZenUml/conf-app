// Error signature for the error radar.
//
// This file is inlined verbatim into the JQL script that radar.py sends to
// Mixpanel, and is also required by signature.test.js. Keep it ES5 — the JQL
// runtime is not a module environment — and keep it free of tenant data.
//
// A signature groups occurrences that are "the same error": event name,
// error_name, http_status, confluence_error_class and the error_message with
// ids, numbers and hashes replaced by placeholders. Without that replacement
// the 400 "same file name as an existing attachment: zenuml-59512" error alone
// becomes one signature per custom content.

var RADAR_ERROR_NAME = /(_failed|_error|_missing|_timeout|_exception|orphan_observed)$/;
var RADAR_MESSAGE_MAX = 160;

function radarIsErrorEvent(name, props) {
  if (!name || name.charAt(0) === '$') return false;
  // conf-app events carry no `product`; Passetta/docat set it.
  if (props && props.product) return false;
  // forgeIndex.ts re-logs every failed attachment write as
  // create_attachment<type>; attachment_upload_failed already carries it with
  // richer fields, so counting both would double every attachment alert.
  if (name.indexOf('create_attachment') === 0) return false;
  if (RADAR_ERROR_NAME.test(name)) return true;
  // Legacy trackEvent(label, action, 'error') calls are real failures and are
  // never sampled (utils/window.ts). 'warning' is also used for probes such as
  // duplication_detect, so it only counts when the name itself says failure.
  return !!props && props.event_category === 'error';
}

function radarNormalize(message) {
  if (message === undefined || message === null) return '';
  var s = String(message);
  // HTML bodies differ only in markup; keep the doctype/tag that identifies them.
  s = s.replace(/<!doctype[\s\S]*$/i, '<html…>').replace(/<html[\s\S]*$/i, '<html…>');
  // Java package prefixes add length, not identity: keep the class name.
  s = s.replace(/\b(?:[a-z][a-z0-9_]*\.){2,}([A-Z]\w*)/g, '$1');
  s = s.replace(/https?:\/\/[^\s"')]+/g, '<url>');
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, '<hex>');
  s = s.replace(/\d+/g, '<n>');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > RADAR_MESSAGE_MAX) s = s.slice(0, RADAR_MESSAGE_MAX) + '…';
  return s;
}

function radarField(value) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function radarSignature(name, props) {
  var p = props || {};
  return [
    name,
    radarField(p.error_name),
    radarField(p.http_status),
    radarField(p.confluence_error_class),
    // Legacy events carry the failure kind in event_label, not error_message.
    radarNormalize(p.error_message !== undefined ? p.error_message : p.event_label) || '-',
  ].join(' | ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { radarIsErrorEvent: radarIsErrorEvent, radarNormalize: radarNormalize, radarSignature: radarSignature };
}
