// Diagnosis of a failed custom-content CREATE that Confluence answered with a
// 404 NOT_FOUND envelope.
//
// Why this exists (2026-08-29 incident, one Lite tenant, 47 save_failed in a
// day = 58% of its save attempts): every event carried the same
// `[{"status":404,"code":"NOT_FOUND","title":"Not Found","detail":null}]` and
// nothing else, so the cause had to be reproduced by hand. On lite-stg
// (2026-08-30, four space-permission sets) that bare envelope came back only
// when the caller lacked the space's "Add attachments" permission — a user
// holding "Add pages" could still edit the page and PUT an existing diagram,
// but could not POST a new one. A page id that does not resolve for the caller
// (bogus id, another user's unpublished draft) returns a DIFFERENT, descriptive
// title ("Unable to find container content…"), and an unknown type is a 400.
// Confluence exposes the same verdict read-only: GET /rest/api/content/{id}
// ?expand=operations lists `create / <our custom-content type>` only alongside
// `create / attachment`.
//
// Everything in this module is pure so the classification and the message
// choice are unit-testable without the wrapper; ApWrapper2.diagnoseCreateNotFound
// performs the single probe request and feeds its body through
// parseContentOperations.

import type { CreateNotFoundShape, MacroTypeValue, SaveFailureProbeStatus, Surface } from '@/utils/analytics/catalog';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

export interface SaveFailureDiagnosis {
  probe_status: SaveFailureProbeStatus;
  page_reachable?: boolean;
  page_status?: string;
  can_create_cc_type?: boolean;
  can_create_attachment?: boolean;
  can_create_page?: boolean;
  can_update_page?: boolean;
}

export const GENERIC_SAVE_FAILED_MESSAGE = 'Failed to save. Please try again.';

/**
 * Classify the 404 NOT_FOUND envelope on an error thrown by
 * ApWrapper2.assertSavedCustomContent (`status` / `code` / `responseErrors`).
 * Returns undefined when the error is not a 404 NOT_FOUND envelope at all
 * (network failure, 400, 5xx) — those are not this module's business.
 */
export function classifyCreateNotFound(error: any): CreateNotFoundShape | undefined {
  const first = Array.isArray(error?.responseErrors) ? error.responseErrors[0] : undefined;
  const status = error?.status ?? first?.status;
  const code = error?.code ?? first?.code;
  if (status !== 404 || code !== 'NOT_FOUND') return undefined;
  const title = String(first?.title ?? '');
  if (title === 'Not Found') return 'bare_not_found';
  if (title.startsWith('Unable to find container content')) return 'container_not_found';
  return 'other';
}

/**
 * Read the caller's own operations on the host page out of a v1
 * `GET /rest/api/content/{id}?expand=operations` body. `ccType` is the fully
 * qualified custom-content type the failed POST used
 * (ApWrapper2.getCustomContentType()).
 */
export function parseContentOperations(body: any, ccType: string): SaveFailureDiagnosis {
  if (!body || typeof body !== 'object') return { probe_status: 'failed' };
  // forgeRequest returns the parsed body regardless of HTTP status; a v1 error
  // arrives as `{ statusCode, message, … }` with no content fields.
  if (typeof body.statusCode === 'number' && body.statusCode >= 400) {
    return { probe_status: 'page_unreachable', page_reachable: false };
  }
  const base: SaveFailureDiagnosis = {
    probe_status: 'failed',
    page_reachable: true,
    page_status: typeof body.status === 'string' ? body.status : undefined,
  };
  if (!Array.isArray(body.operations)) return base;
  const has = (operation: string, targetType: string) =>
    body.operations.some((op: any) => op?.operation === operation && op?.targetType === targetType);
  return {
    ...base,
    probe_status: 'ok',
    can_create_cc_type: has('create', ccType),
    can_create_attachment: has('create', 'attachment'),
    can_create_page: has('create', 'page'),
    can_update_page: has('update', 'page'),
  };
}

/**
 * The toast / dialog copy for a failed save. Only a probe that positively
 * shows the caller cannot create our type names the permission; every other
 * outcome keeps the historical generic text so an unproven cause is never
 * presented as fact.
 */
export function userMessageForSaveFailure(diagnosis: SaveFailureDiagnosis | undefined): string {
  if (!diagnosis) return GENERIC_SAVE_FAILED_MESSAGE;
  if (diagnosis.probe_status === 'page_unreachable') {
    return 'Failed to save: Confluence could not find this page for your account. If the page is an unpublished draft, publish it first, then try again.';
  }
  if (diagnosis.probe_status === 'ok' && diagnosis.can_create_cc_type === false) {
    return "Failed to save: you don't have the \"Add attachments\" permission in this space, which Confluence requires to create a diagram. Ask a space admin to grant it — retrying will not help.";
  }
  return GENERIC_SAVE_FAILED_MESSAGE;
}

export interface SaveFailureContext {
  surface: Surface;
  macro_type?: MacroTypeValue;
}

export interface CreateNotFoundProber {
  diagnoseCreateNotFound(): Promise<SaveFailureDiagnosis>;
}

/** Upper bound on the probe; the toast must not wait on a wedged request. */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

/**
 * The one call every editor's save catch block makes. For a create-time 404
 * it runs the operations probe (time-capped), records the verdict on
 * `save_failed_diagnosed`, and returns the copy to show; for any other error
 * it returns the generic copy without a request or an event. Never rejects.
 */
export async function diagnoseSaveFailure(
  error: any,
  ctx: SaveFailureContext,
  prober: CreateNotFoundProber,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const shape: CreateNotFoundShape | undefined = error?.errorShape ?? classifyCreateNotFound(error);
  if (!shape) return GENERIC_SAVE_FAILED_MESSAGE;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SaveFailureDiagnosis>((resolve) => {
    timer = setTimeout(() => resolve({ probe_status: 'failed' }), timeoutMs);
  });
  let diagnosis: SaveFailureDiagnosis;
  try {
    diagnosis = await Promise.race([prober.diagnoseCreateNotFound(), timeout]);
  } catch {
    diagnosis = { probe_status: 'failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }

  try {
    trackAnalyticsEvent('save_failed_diagnosed', {
      feature_area: 'macro',
      surface: ctx.surface,
      macro_type: ctx.macro_type,
      error_shape: shape,
      error_code: error?.code ?? undefined,
      ...diagnosis,
    });
  } catch {
    // Analytics must never turn a diagnosed failure into a second failure.
  }
  return userMessageForSaveFailure(diagnosis);
}
