import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOpenApiViewerTarget, buildOpenApiEditorTarget, resolveOpenApiId } from './openApiTarget';
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { findLegacyCustomContentByUuid: vi.fn() } },
}));
vi.mock('@/utils/window', () => ({ trackEvent: vi.fn() }));

import globals from '@/model/globals';
import { trackEvent } from '@/utils/window';

describe('openApiTarget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('viewer target resolves from config first, falls back to modal, tags source', () => {
    const target = buildOpenApiViewerTarget();
    expect(target.resolveId({ extension: { config: { customContentId: 'cc-config' } } }))
      .toEqual({ contentId: 'cc-config', source: 'config' });
    expect(target.resolveId({ extension: { modal: { customContentId: 'cc-modal' } } }))
      .toEqual({ contentId: 'cc-modal', source: 'modal' });
    expect(target.resolveId({ extension: {} })).toBeUndefined();
  });

  it('viewer target: onMiss=fail, no defaultDoc', () => {
    const target = buildOpenApiViewerTarget();
    expect(target.onMiss).toBe('fail');
    expect(target.defaultDoc).toBeUndefined();
  });

  it('editor target: onMiss=default-doc resolves to a NULL_DIAGRAM-shaped doc', () => {
    const target = buildOpenApiEditorTarget();
    expect(target.onMiss).toBe('default-doc');
    expect(target.defaultDoc!()).toEqual(NULL_DIAGRAM);
  });

  it('editor target: defaultDoc() returns a fresh object each call, never the shared singleton', () => {
    // Regression guard: the editor's save handler mutates whatever defaultDoc()
    // returns (Object.assign(window.diagram || {}, diagram)) — returning the
    // module-level NULL_DIAGRAM singleton directly would corrupt it for every
    // other caller in the same session.
    const target = buildOpenApiEditorTarget();
    const first = target.defaultDoc!();
    const second = target.defaultDoc!();
    expect(first).not.toBe(NULL_DIAGRAM);
    expect(first).not.toBe(second);
  });

  it('resolveOpenApiId is exported directly for reuse outside the TargetSpec (forge-swagger-ui.ts dedupe)', () => {
    expect(resolveOpenApiId({ extension: { config: { customContentId: 'cc-config' } } }))
      .toEqual({ contentId: 'cc-config', source: 'config' });
    expect(resolveOpenApiId({ extension: { modal: { customContentId: 'cc-modal' } } }))
      .toEqual({ contentId: 'cc-modal', source: 'modal' });
    expect(resolveOpenApiId({ extension: {} })).toBeUndefined();
  });

  it('both targets tag macroType openapi', () => {
    expect(buildOpenApiViewerTarget().macroType).toBe('openapi');
    expect(buildOpenApiEditorTarget().macroType).toBe('openapi');
  });

  it('uuid-title fallback: no config.uuid -> undefined, no API call', async () => {
    const target = buildOpenApiViewerTarget();
    const doc = await target.legacyFallbacks[0]({ context: { extension: { config: {} } } });
    expect(doc).toBeUndefined();
    expect(globals.apWrapper.findLegacyCustomContentByUuid).not.toHaveBeenCalled();
  });

  it('uuid-title fallback: recovery hit stamps recoveredFromOrphan and fires the viewer-tagged event', async () => {
    const recoveredDoc = { ...NULL_DIAGRAM, code: 'from uuid', isCopy: true };
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue({
      id: 'cc-recovered', value: recoveredDoc,
    } as any);
    const target = buildOpenApiViewerTarget();
    const doc = await target.legacyFallbacks[0]({
      context: { extension: { config: { uuid: 'uuid-1' } } }, pageId: 'page-1',
    });
    expect(doc).toBe(recoveredDoc);
    expect(doc!.recoveredFromOrphan).toBe(true);
    expect(trackEvent).toHaveBeenCalledWith('uuid-1', 'legacy_custom_content_by_uuid_restored', 'info', {
      surface: 'viewer',
      macro_type: 'openapi',
      recovered_id: 'cc-recovered',
      is_copy: 'true',
      page_id: 'page-1',
    });
  });

  it('uuid-title fallback: editor target tags surface editor', async () => {
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue({
      id: 'cc-recovered', value: { ...NULL_DIAGRAM, isCopy: false },
    } as any);
    const target = buildOpenApiEditorTarget();
    await target.legacyFallbacks[0]({ context: { extension: { config: { uuid: 'uuid-1' } } } });
    expect(trackEvent).toHaveBeenCalledWith('uuid-1', 'legacy_custom_content_by_uuid_restored', 'info',
      expect.objectContaining({ surface: 'editor' }));
  });

  it('uuid-title fallback: no recovery match returns undefined', async () => {
    vi.mocked(globals.apWrapper.findLegacyCustomContentByUuid).mockResolvedValue(undefined);
    const target = buildOpenApiViewerTarget();
    const doc = await target.legacyFallbacks[0]({ context: { extension: { config: { uuid: 'uuid-1' } } } });
    expect(doc).toBeUndefined();
  });
});
