import type { CaptureFailureStage, MacroTypeValue } from '@/utils/analytics/catalog';

/**
 * Failure details for a DOM-to-PNG capture (#1061).
 *
 * Kept apart from captureBlob.ts so callers that only need the stage or the
 * text do not import the capture pipeline. Nothing here may carry diagram
 * text: the output goes to analytics as `capture_error`.
 */

export const CAPTURE_ERROR_MAX_LENGTH = 120;

/**
 * A capture rejection that remembers which step failed. The original reason
 * stays on `cause`, so a caller that only wants "it rejected" is unaffected.
 */
export class CaptureStageError extends Error {
  readonly stage: CaptureFailureStage;
  readonly cause: unknown;

  constructor(stage: CaptureFailureStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : describeCaptureError(cause));
    this.name = 'CaptureStageError';
    this.stage = stage;
    this.cause = cause;
  }
}

export function captureStageOf(error: unknown): CaptureFailureStage {
  return error instanceof CaptureStageError ? error.stage : 'unknown';
}

/** Run one capture step; any rejection or throw leaves it tagged with `stage`. */
export async function withCaptureStage<T>(stage: CaptureFailureStage, step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    throw e instanceof CaptureStageError ? e : new CaptureStageError(stage, e);
  }
}

const URL_PATTERNS = [
  /data:[^\s,]*,\S*/gi, // data URLs, payload included
  /(?:[a-z][a-z0-9+.-]*:)?\/\/\S+/gi, // http(s)://, blob:https://, //host/path
  /\bblob:\S+/gi,
];

function sanitize(text: string): string {
  let out = text;
  for (const pattern of URL_PATTERNS) out = out.replace(pattern, '<url>');
  out = out.replace(/\?\S+/g, ''); // a query string that was not part of a URL
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > CAPTURE_ERROR_MAX_LENGTH ? out.slice(0, CAPTURE_ERROR_MAX_LENGTH) : out;
}

function describeEvent(event: Event): string {
  const target = event.target as { tagName?: unknown } | null;
  const tag = typeof target?.tagName === 'string' ? target.tagName.toLowerCase() : '';
  const kind = tag === 'img' ? 'image' : tag;
  return `${kind ? `${kind} ` : ''}${event.type || 'unknown'} event`;
}

/**
 * Short, URL-free text for any rejection value. A raw DOM `Event` (what
 * html-to-image rejects with when an image fails to load) becomes
 * "image error event" instead of "[object Event]".
 */
export function describeCaptureError(error: unknown): string {
  if (error instanceof CaptureStageError) return describeCaptureError(error.cause);
  if (typeof Event !== 'undefined' && error instanceof Event) return sanitize(describeEvent(error));
  if (error instanceof Error) return sanitize(`${error.name}: ${error.message}`);
  if (typeof error === 'string') return sanitize(error);
  if (error === undefined || error === null) return 'no error value';
  return `non-error ${typeof error}`;
}

const MACRO_TYPES: Record<string, MacroTypeValue> = {
  sequence: 'sequence',
  zenuml: 'sequence',
  mermaid: 'mermaid',
  plantuml: 'plantuml',
  graph: 'graph',
  openapi: 'openapi',
  asyncapi: 'asyncapi',
  embed: 'embed',
  markdown: 'markdown',
};

/** Analytics `macro_type` for the `diagramType` string the attachment code already has. */
export function captureMacroType(diagramType?: string): MacroTypeValue {
  return MACRO_TYPES[(diagramType ?? '').toLowerCase()] ?? 'none';
}
