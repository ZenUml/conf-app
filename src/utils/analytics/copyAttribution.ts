import type { CopySource } from './catalog';
import { generateJourneyId } from '@/utils/journeyTracking';

export type CopyJob = 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests';

export type CopyAttributionMarker = {
  copy_id: string;
  copy_source: CopySource;
  copy_job?: CopyJob;
  copied_at: number;
  custom_content_id: string;
};

const COPY_ATTRIBUTION_PREFIX = 'zenuml_copy_attribution:';
export const COPY_ATTRIBUTION_TTL_MS = 60 * 60 * 1_000;

function storageKey(customContentId: string): string {
  return `${COPY_ATTRIBUTION_PREFIX}${customContentId}`;
}

export function recordSuccessfulCopyAttribution({
  customContentId,
  source,
  job,
  now = Date.now(),
}: {
  customContentId: string | number | null | undefined;
  source: CopySource;
  job?: CopyJob;
  now?: number;
}): CopyAttributionMarker | null {
  const normalizedId = String(customContentId ?? '').trim();
  if (!normalizedId) return null;

  const marker: CopyAttributionMarker = {
    copy_id: generateJourneyId(),
    copy_source: source,
    ...(job ? { copy_job: job } : {}),
    copied_at: now,
    custom_content_id: normalizedId,
  };

  try {
    sessionStorage.setItem(storageKey(normalizedId), JSON.stringify(marker));
    return marker;
  } catch (error) {
    console.warn('[Copy attribution] sessionStorage write failed:', error);
    return null;
  }
}

export function readCopyAttribution(
  customContentId: string | number | null | undefined,
  now = Date.now(),
): CopyAttributionMarker | null {
  const normalizedId = String(customContentId ?? '').trim();
  if (!normalizedId) return null;

  const key = storageKey(normalizedId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const marker = JSON.parse(raw) as Partial<CopyAttributionMarker>;
    const valid = typeof marker.copy_id === 'string'
      && (marker.copy_source === 'copy_for_ai' || marker.copy_source === 'view_source')
      && typeof marker.copied_at === 'number'
      && marker.custom_content_id === normalizedId;
    if (!valid || now - marker.copied_at! > COPY_ATTRIBUTION_TTL_MS || now < marker.copied_at!) {
      sessionStorage.removeItem(key);
      return null;
    }
    return marker as CopyAttributionMarker;
  } catch (error) {
    console.warn('[Copy attribution] sessionStorage read failed:', error);
    return null;
  }
}
