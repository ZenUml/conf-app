import api, { route } from '@forge/api';

import {
  extractExportContext,
  joinKeyProps,
  trackExportEvent,
  createErrorDocument,
} from './export.js';

// ---------------------------------------------------------------------------
// AsyncAPI macro export (adfExport: asyncApiExportMacro)
//
// Dedicated export handler for the AsyncAPI macros (zenuml-asyncapi-macro and
// zenuml-asyncapi-embed-macro). AsyncAPI specs are text — the viewer never
// generates a PNG attachment — so unlike the shared image-export path
// (src/export.js → exportMacro), this handler skips the attachment lookup
// entirely and embeds the raw spec as a YAML code block.
//
// Keeping this in its own function (instead of a branch inside the shared
// exportMacro) means lite/full/diagramly carry no AsyncAPI export logic and
// need no runtime flag: those variants strip the AsyncAPI macros, so this
// handler is simply never wired up there.
//
// Reuses the shared context/tracking/error helpers exported from export.js so
// AsyncAPI exports show up in the same analytics with the same join keys.
// ---------------------------------------------------------------------------

const MAX_SPEC_CHARS = 40000;

export const handler = async (payload) => {
  const ctx = extractExportContext(payload);
  const { customContentId } = ctx;

  await trackExportEvent('macro_export_requested', joinKeyProps(ctx));

  try {
    if (!customContentId) {
      console.warn('AsyncAPI export: no customContentId');
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'missing_custom_content_id',
      });
      return createErrorDocument('Diagram content not available for export');
    }

    const specDoc = await buildAsyncApiSpecDocument(customContentId);
    if (specDoc) {
      await trackExportEvent('macro_export_succeeded', {
        ...joinKeyProps(ctx),
        export_path: 'asyncapi_spec',
      });
      return specDoc;
    }

    await trackExportEvent('macro_export_failed', {
      ...joinKeyProps(ctx),
      failure_reason: 'asyncapi_spec_unavailable',
    });
    return createErrorDocument(
      'AsyncAPI specification not available for export. It may have been deleted, or stored under a different custom-content type.',
    );
  } catch (error) {
    const errorName = error?.name ?? 'UnknownError';
    console.error('AsyncAPI export function error:', error);
    await trackExportEvent('macro_export_failed', {
      ...joinKeyProps(ctx),
      failure_reason: `unexpected_error:${errorName}`,
      error_name: errorName,
      error_message: String(error?.message ?? error ?? '').slice(0, 200),
    });
    return createErrorDocument('Error generating export content');
  }
};

/**
 * Fetch the AsyncAPI custom content and build an ADF doc that embeds the raw
 * spec as a YAML code block (title + codeBlock). Returns null when the content
 * can't be loaded or doesn't hold an AsyncAPI spec, so the caller can render a
 * clear error instead. Ported from AsyncAPI-Conf-V2/src/backend/export.js.
 */
async function buildAsyncApiSpecDocument(customContentId) {
  const response = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/custom-content/${customContentId}?body-format=raw`);
  if (!response.ok) {
    console.debug(`AsyncAPI export: custom-content lookup ${response.status}`);
    return null;
  }

  const customContent = await response.json();
  const rawValue = customContent?.body?.raw?.value;
  if (!rawValue) return null;

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (e) {
    console.debug('AsyncAPI export: custom-content body is not JSON', e?.message);
    return null;
  }

  const spec = parsed?.code;
  if (typeof spec !== 'string' || spec.trim().length === 0) return null;

  const title = parsed?.title || customContent?.title || 'AsyncAPI Specification';
  const text =
    spec.length > MAX_SPEC_CHARS
      ? `${spec.slice(0, MAX_SPEC_CHARS)}\n\n# (truncated for export)`
      : spec;

  return {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: title, marks: [{ type: 'strong' }] }] },
      { type: 'codeBlock', attrs: { language: 'yaml' }, content: [{ type: 'text', text }] },
    ],
  };
}
