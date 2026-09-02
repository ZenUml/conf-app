import { callRemote } from '@/utils/requestUtil';

export interface DiagramImpactSummary {
  audienceCount: number;
  viewerRelation: 'creator' | 'updater' | 'contributor' | 'viewer';
}

export async function getDiagramImpact(customContentId: string): Promise<DiagramImpactSummary> {
  return callRemote(`/api/diagram-impact?customContentId=${encodeURIComponent(customContentId)}`, 'GET');
}

/**
 * `gateVersion` records which dwell rule produced the row, so counts written
 * before and after 2026-09-02 stay comparable. It comes from the build, not
 * from the user, and an older client still in a browser keeps sending 1.
 */
export const DWELL_GATE_VERSION = 2;

export type RegistrationResult = 'new_unique' | 'repeat' | 'excluded_contributor' | 'write_failed';

export interface DiagramImpactRegistration {
  audienceCount: number;
  // `write_failed` arrives with HTTP 200: the backend refuses to fail a page
  // view over a derived table, so the outcome is in the body instead of the
  // status. Reporting it as a success would put a number in Mixpanel that no
  // row backs.
  result?: RegistrationResult;
}

export async function registerDiagramImpactView(customContentId: string): Promise<DiagramImpactRegistration> {
  return callRemote('/api/diagram-impact/view', 'POST', {
    customContentId,
    gateVersion: DWELL_GATE_VERSION,
  });
}
