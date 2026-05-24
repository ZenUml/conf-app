import { trackEvent } from '@/utils/window';

export type LegacyMacroKind = 'sequence' | 'graph';
export type LegacySurface = 'viewer' | 'editor';

// ZEN-1170 Defect 1 telemetry. Mirrors the existing orphanTelemetry style
// (legacy trackEvent, not the typed catalog) so this family of events stays
// queryable alongside customcontent_orphan_observed in Mixpanel.

export function reportLegacyContentPropertyRestored(
  surface: LegacySurface,
  macroKind: LegacyMacroKind,
  uuid: string,
  options: { pageId?: string; valueType?: 'object' | 'string_legacy' } = {},
): void {
  try {
    trackEvent(uuid, 'legacy_content_property_restored', 'info', {
      surface,
      macro_type: macroKind,
      uuid,
      ...(options.pageId && { page_id: options.pageId }),
      value_type: options.valueType ?? 'object',
    });
  } catch (e) {
    console.warn('[legacyContentPropertyTelemetry] restored event failed', e);
  }
}

export function reportLegacyContentPropertyLoadFailed(
  surface: LegacySurface,
  macroKind: LegacyMacroKind,
  uuid: string,
  reason: 'forbidden' | 'http' | 'parse' | 'thrown',
  options: { pageId?: string; httpStatus?: number } = {},
): void {
  try {
    trackEvent(uuid, 'legacy_content_property_load_failed', 'warning', {
      surface,
      macro_type: macroKind,
      uuid,
      reason,
      ...(options.pageId && { page_id: options.pageId }),
      ...(options.httpStatus != null && { http_status: options.httpStatus }),
    });
  } catch (e) {
    console.warn('[legacyContentPropertyTelemetry] load_failed event failed', e);
  }
}

export function reportLegacyContentPropertyValueUnexpected(
  surface: LegacySurface,
  macroKind: LegacyMacroKind,
  uuid: string,
  valueType: 'string' | 'null' | 'other',
): void {
  try {
    trackEvent(uuid, 'legacy_content_property_value_unexpected', 'warning', {
      surface,
      macro_type: macroKind,
      uuid,
      value_type: valueType,
    });
  } catch (e) {
    console.warn('[legacyContentPropertyTelemetry] value_unexpected event failed', e);
  }
}

export function reportSaveRefusedLegacyLoadBlocked(
  macroKind: string,
  source: string | undefined,
): void {
  try {
    trackEvent('save_refused', 'save_refused_legacy_load_blocked', 'warning', {
      macro_type: macroKind,
      source: source ?? 'unknown',
    });
  } catch (e) {
    console.warn('[legacyContentPropertyTelemetry] save_refused event failed', e);
  }
}

// ZEN-1170 Defect 1: emitted when a legacy uuid-only macro is migrated to a
// CustomContent-backed macro via view.submit({config: {customContentId}}).
// Mirrors reportOrphanMacroRepaired (Defect 2b) — only fires when the repair
// surface (inserting or configuring) can actually persist the macro XML.
export function reportLegacyContentPropertyMacroRepaired(
  macroKind: LegacyMacroKind,
  legacyUuid: string,
  newCustomContentId: string,
  options: { pageId?: string } = {},
): void {
  try {
    trackEvent(legacyUuid, 'legacy_content_property_macro_repaired', 'info', {
      macro_type: macroKind,
      legacy_uuid: legacyUuid,
      new_custom_content_id: newCustomContentId,
      ...(options.pageId && { page_id: options.pageId }),
    });
  } catch (e) {
    console.warn('[legacyContentPropertyTelemetry] macro_repaired event failed', e);
  }
}
