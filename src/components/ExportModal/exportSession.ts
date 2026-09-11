import type { Annotation } from './useAnnotations';
import type { WatermarkState } from './useExportState';

/**
 * The export workspace is deliberately ephemeral. This snapshot bridges the
 * two Custom UI iframes used by an export-from-viewer flow, but never reaches
 * Confluence storage or browser persistence.
 */
export interface ExportSessionSnapshot {
  annotations: Annotation[];
  watermark: WatermarkState;
  watermarkVisible: boolean;
  background: string;
  customBgColor: string;
}

export interface ExportSessionEventPayload {
  macro_uuid: string;
  snapshot: ExportSessionSnapshot | null;
}

export interface ExportSessionClosePayload {
  exportSession: ExportSessionSnapshot | null;
}

export const EXPORT_SESSION_EVENT = 'zenuml-export-session-updated';

let exportSession: ExportSessionSnapshot | null = null;
let contextSeeded = false;
let bridgeEventsPromise: Promise<typeof import('@forge/bridge')> | null = null;
let bridgePublishQueue: Promise<void> = Promise.resolve();

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && isBoundedNumber(value.x, 0, 1) && isBoundedNumber(value.y, 0, 1);
}

function isAnnotation(value: unknown): value is Annotation {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id)
    && (value.type === 'note' || value.type === 'arrow' || value.type === 'callout' || value.type === 'rectangle')
    && isPoint(value.position)
    && isPoint(value.end)
    && typeof value.text === 'string'
    && isHexColor(value.color)
    && (value.bgColor === 'none' || isHexColor(value.bgColor))
    && isBoundedNumber(value.fontSize, 8, 72)
    && isBoundedNumber(value.thickness, 1, 12)
    && (value.arrowType === '→' || value.arrowType === '←' || value.arrowType === '←→');
}

function isWatermark(value: unknown): value is WatermarkState {
  if (!isRecord(value)) return false;
  return typeof value.text === 'string'
    && isBoundedNumber(value.opacity, 0, 100)
    && isBoundedNumber(value.fontSize, 8, 72)
    && isHexColor(value.color)
    && (value.position === 'diagonal' || value.position === 'bottom-right');
}

export function isExportSessionSnapshot(value: unknown): value is ExportSessionSnapshot {
  if (!isRecord(value)) return false;
  const seenIds = new Set<string>();
  if (!Array.isArray(value.annotations)) return false;
  for (const annotation of value.annotations) {
    if (!isAnnotation(annotation) || seenIds.has(annotation.id)) return false;
    seenIds.add(annotation.id);
  }
  return Array.isArray(value.annotations)
    && isWatermark(value.watermark)
    && typeof value.watermarkVisible === 'boolean'
    && (value.background === 'transparent'
      || value.background === 'white'
      || value.background === 'warm'
      || value.background === 'cool'
      || value.background === 'custom')
    && isHexColor(value.customBgColor);
}

export function isExportSessionEventPayload(value: unknown): value is ExportSessionEventPayload {
  return isRecord(value)
    && typeof value.macro_uuid === 'string'
    && value.macro_uuid.length > 0
    && (value.snapshot === null || isExportSessionSnapshot(value.snapshot));
}

export function isExportSessionClosePayload(value: unknown): value is ExportSessionClosePayload {
  return isRecord(value)
    && (value.exportSession === null || isExportSessionSnapshot(value.exportSession));
}

function cloneSnapshot(snapshot: ExportSessionSnapshot): ExportSessionSnapshot {
  return {
    annotations: snapshot.annotations.map((annotation) => ({
      ...annotation,
      position: { ...annotation.position },
      end: { ...annotation.end },
    })),
    watermark: { ...snapshot.watermark },
    watermarkVisible: snapshot.watermarkVisible,
    background: snapshot.background,
    customBgColor: snapshot.customBgColor,
  };
}

function getModalContext(): UnknownRecord | null {
  if (typeof window === 'undefined') return null;
  const runtimeWindow = window as typeof window & { forgeGlobal?: unknown };
  const forgeGlobal = runtimeWindow.forgeGlobal;
  if (!isRecord(forgeGlobal) || !isRecord(forgeGlobal.forgeContext)) return null;
  const extension = forgeGlobal.forgeContext.extension;
  if (!isRecord(extension) || !isRecord(extension.modal)) return null;
  return extension.modal;
}

function seedFromModalContext(): void {
  if (contextSeeded) return;
  const modal = getModalContext();
  // forgeGlobal is populated during bootstrap. If the first read happens
  // before that, leave the gate open for the next read rather than losing the
  // one-shot context handoff.
  if (!modal) return;
  contextSeeded = true;
  if (isExportSessionSnapshot(modal.exportSession)) {
    exportSession = cloneSnapshot(modal.exportSession);
  }
}

function publish(snapshot: ExportSessionSnapshot | null): void {
  const modal = getModalContext();
  if (modal?.macroMode !== 'fullscreen' || typeof modal.macro_uuid !== 'string' || !modal.macro_uuid) return;

  bridgeEventsPromise ??= import('@forge/bridge');
  const payload: ExportSessionEventPayload = {
    macro_uuid: modal.macro_uuid,
    snapshot: snapshot ? cloneSnapshot(snapshot) : null,
  };
  // State writes stay synchronous; serialize bridge sends so a rapid drag
  // cannot let an older snapshot overtake a newer one in the parent iframe.
  bridgePublishQueue = bridgePublishQueue
    .catch(() => undefined)
    .then(async () => {
      const { events } = await bridgeEventsPromise!;
      await events.emit(EXPORT_SESSION_EVENT, payload);
    })
    .catch((error: unknown) => {
      console.warn('[exportSession] bridge handoff failed:', error);
    });
}

export function readExportSession(): ExportSessionSnapshot | null {
  seedFromModalContext();
  return exportSession ? cloneSnapshot(exportSession) : null;
}

export function writeExportSession(snapshot: ExportSessionSnapshot | null): void {
  seedFromModalContext();
  if (snapshot !== null && !isExportSessionSnapshot(snapshot)) return;
  exportSession = snapshot ? cloneSnapshot(snapshot) : null;
  publish(exportSession);
}

/** Apply a cross-iframe update without publishing it back to the sender. */
export function receiveExportSession(snapshot: unknown): boolean {
  if (snapshot === null) {
    exportSession = null;
    return true;
  }
  if (!isExportSessionSnapshot(snapshot)) return false;
  exportSession = cloneSnapshot(snapshot);
  return true;
}
