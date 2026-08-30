import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import {
  classifyCreateNotFound,
  parseContentOperations,
  userMessageForSaveFailure,
  diagnoseSaveFailure,
  GENERIC_SAVE_FAILED_MESSAGE,
} from './saveFailureDiagnosis';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const CC_TYPE = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence';

// Error objects shaped the way ApWrapper2.assertSavedCustomContent throws
// them: `status` / `code` lifted off the first Atlassian error-envelope entry,
// `responseErrors` carrying the raw array.
function envelopeError(errors: any[]): any {
  const err: any = new Error('createCustomContentV2: save returned no usable customContentId');
  err.status = errors[0]?.status;
  err.code = errors[0]?.code;
  err.responseErrors = errors;
  return err;
}

describe('classifyCreateNotFound', () => {
  it('classifies the bare "Not Found" envelope as bare_not_found', () => {
    const err = envelopeError([{ status: 404, code: 'NOT_FOUND', title: 'Not Found', detail: null }]);
    expect(classifyCreateNotFound(err)).toBe('bare_not_found');
  });

  it('classifies the "Unable to find container content" envelope as container_not_found', () => {
    const err = envelopeError([{
      status: 404, code: 'NOT_FOUND', detail: null,
      title: 'Unable to find container content. Container content type is page. Container content ID is [241828331].',
    }]);
    expect(classifyCreateNotFound(err)).toBe('container_not_found');
  });

  it('classifies any other 404 NOT_FOUND title as other', () => {
    const err = envelopeError([{ status: 404, code: 'NOT_FOUND', title: 'Something else', detail: null }]);
    expect(classifyCreateNotFound(err)).toBe('other');
  });

  it('returns undefined for a non-404 envelope', () => {
    const err = envelopeError([{ status: 400, code: 'INVALID_REQUEST_BODY', title: 'Bad', detail: null }]);
    expect(classifyCreateNotFound(err)).toBeUndefined();
  });

  it('returns undefined for a thrown network error with no envelope', () => {
    expect(classifyCreateNotFound(new TypeError('Failed to fetch'))).toBeUndefined();
    expect(classifyCreateNotFound(undefined)).toBeUndefined();
  });
});

describe('parseContentOperations', () => {
  // Verbatim shape of GET /rest/api/content/{id}?expand=operations for a user
  // holding view + "Add attachments" (lite-stg, 2026-08-30).
  const withAttachment = {
    id: '241795800', status: 'current',
    operations: [
      { operation: 'read', targetType: 'page' },
      { operation: 'view_analytics', targetType: 'page' },
      { operation: 'create', targetType: 'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph' },
      { operation: 'create', targetType: 'attachment' },
      { operation: 'create', targetType: CC_TYPE },
    ],
  };
  // Same user holding view + "Add pages" only: page create present, no
  // attachment and no custom-content type — the population that gets the bare 404.
  const pageOnly = {
    id: '241861353', status: 'current',
    operations: [
      { operation: 'read', targetType: 'page' },
      { operation: 'create', targetType: 'page' },
      { operation: 'create', targetType: 'whiteboard' },
    ],
  };

  it('reports create permission for our type alongside attachment permission', () => {
    expect(parseContentOperations(withAttachment, CC_TYPE)).toEqual({
      probe_status: 'ok',
      page_reachable: true,
      page_status: 'current',
      can_create_cc_type: true,
      can_create_attachment: true,
      can_create_page: false,
      can_update_page: false,
    });
  });

  it('reports the Add-pages-only user as unable to create our type', () => {
    expect(parseContentOperations(pageOnly, CC_TYPE)).toMatchObject({
      probe_status: 'ok',
      can_create_cc_type: false,
      can_create_attachment: false,
      can_create_page: true,
    });
  });

  it('reads update permission from an update/page operation', () => {
    const body = { ...pageOnly, operations: [...pageOnly.operations, { operation: 'update', targetType: 'page' }] };
    expect(parseContentOperations(body, CC_TYPE).can_update_page).toBe(true);
  });

  it('marks the page unreachable when the probe returns an error envelope', () => {
    const body = { statusCode: 404, message: 'com.atlassian.confluence.api.service.exceptions.NotFoundException' };
    expect(parseContentOperations(body, CC_TYPE)).toEqual({
      probe_status: 'page_unreachable',
      page_reachable: false,
    });
  });

  it('marks the probe failed when the body has no operations array', () => {
    expect(parseContentOperations({ id: '1', status: 'current' }, CC_TYPE)).toEqual({
      probe_status: 'failed',
      page_reachable: true,
      page_status: 'current',
    });
    expect(parseContentOperations(undefined, CC_TYPE)).toEqual({ probe_status: 'failed' });
  });
});

describe('userMessageForSaveFailure', () => {
  it('names the missing space permission when Confluence reports the caller cannot create our type', () => {
    const msg = userMessageForSaveFailure({ probe_status: 'ok', page_reachable: true, can_create_cc_type: false, can_create_page: true });
    expect(msg).toMatch(/Add attachments/);
    expect(msg).toMatch(/space admin/i);
    expect(msg).not.toMatch(/try again/i);
  });

  it('keeps the generic retry message when the probe did not prove a permission gap', () => {
    expect(userMessageForSaveFailure(undefined)).toBe('Failed to save. Please try again.');
    expect(userMessageForSaveFailure({ probe_status: 'failed' })).toBe('Failed to save. Please try again.');
    expect(userMessageForSaveFailure({ probe_status: 'ok', page_reachable: true, can_create_cc_type: true }))
      .toBe('Failed to save. Please try again.');
  });

  it('explains an unreachable host page without blaming permissions', () => {
    const msg = userMessageForSaveFailure({ probe_status: 'page_unreachable', page_reachable: false });
    expect(msg).toMatch(/page/i);
    expect(msg).not.toMatch(/Add attachments/);
  });
});

// The orchestration every editor's catch block calls: probe once, record the
// verdict on save_failed_diagnosed, hand back the copy to show.
describe('diagnoseSaveFailure', () => {
  const ctx = { surface: 'editor' as const, macro_type: 'mermaid' as const };
  const permissionGap = {
    probe_status: 'ok' as const, page_reachable: true, page_status: 'current',
    can_create_cc_type: false, can_create_attachment: false, can_create_page: true, can_update_page: true,
  };
  function bare404(): any {
    const err: any = new Error('createCustomContentV2: save returned no usable customContentId: […]');
    err.status = 404; err.code = 'NOT_FOUND'; err.errorShape = 'bare_not_found';
    return err;
  }

  beforeEach(() => vi.clearAllMocks());

  it('probes, records the verdict on save_failed_diagnosed, and returns the permission message', async () => {
    const probe = vi.fn().mockResolvedValue(permissionGap);

    const message = await diagnoseSaveFailure(bare404(), ctx, { diagnoseCreateNotFound: probe });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('save_failed_diagnosed', expect.objectContaining({
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'mermaid',
      error_shape: 'bare_not_found',
      error_code: 'NOT_FOUND',
      ...permissionGap,
    }));
    expect(message).toMatch(/Add attachments/);
  });

  it('does not probe and keeps the generic message when the error is not a create 404', async () => {
    const probe = vi.fn();
    const message = await diagnoseSaveFailure(new TypeError('Failed to fetch'), ctx, { diagnoseCreateNotFound: probe });
    expect(probe).not.toHaveBeenCalled();
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    expect(message).toBe(GENERIC_SAVE_FAILED_MESSAGE);
  });

  it('still records the shape when the probe cannot answer, and keeps the generic message', async () => {
    const probe = vi.fn().mockResolvedValue({ probe_status: 'failed' });
    const message = await diagnoseSaveFailure(bare404(), ctx, { diagnoseCreateNotFound: probe });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('save_failed_diagnosed', expect.objectContaining({
      error_shape: 'bare_not_found', probe_status: 'failed',
    }));
    expect(message).toBe(GENERIC_SAVE_FAILED_MESSAGE);
  });

  it('gives up on a hanging probe after the time cap instead of blocking the toast', async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
      const pending = diagnoseSaveFailure(bare404(), ctx, { diagnoseCreateNotFound: probe }, { timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toBe(GENERIC_SAVE_FAILED_MESSAGE);
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('save_failed_diagnosed', expect.objectContaining({
        error_shape: 'bare_not_found', probe_status: 'failed',
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('never rejects when the probe itself throws', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(diagnoseSaveFailure(bare404(), ctx, { diagnoseCreateNotFound: probe })).resolves.toBe(GENERIC_SAVE_FAILED_MESSAGE);
  });
});
