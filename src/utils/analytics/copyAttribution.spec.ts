import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPY_ATTRIBUTION_TTL_MS,
  readCopyAttribution,
  recordSuccessfulCopyAttribution,
} from './copyAttribution';

describe('copy attribution marker', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips successful copy metadata for the same custom content without storing DSL', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

    const written = recordSuccessfulCopyAttribution({
      customContentId: '12345',
      source: 'copy_for_ai',
      job: 'update',
      now: 1_000,
    });

    expect(written).toEqual({
      copy_id: '11111111-1111-4111-8111-111111111111',
      copy_source: 'copy_for_ai',
      copy_job: 'update',
      copied_at: 1_000,
      custom_content_id: '12345',
    });
    expect(readCopyAttribution('12345', 1_500)).toEqual(written);
    expect(sessionStorage.getItem('zenuml_copy_attribution:12345')).not.toContain('dsl');
  });

  it('expires attribution after 60 minutes and never crosses content ids', () => {
    recordSuccessfulCopyAttribution({
      customContentId: '12345',
      source: 'view_source',
      now: 1_000,
    });

    expect(readCopyAttribution('different-id', 1_500)).toBeNull();
    expect(readCopyAttribution('12345', 1_000 + COPY_ATTRIBUTION_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem('zenuml_copy_attribution:12345')).toBeNull();
  });

  it('keeps a successful copy usable when session storage is unavailable', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });

    expect(recordSuccessfulCopyAttribution({
      customContentId: '12345',
      source: 'copy_for_ai',
      job: 'explain',
    })).toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });
});
