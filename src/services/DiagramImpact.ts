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

export async function registerDiagramImpactView(customContentId: string): Promise<Pick<DiagramImpactSummary, 'audienceCount'>> {
  return callRemote('/api/diagram-impact/view', 'POST', {
    customContentId,
    gateVersion: DWELL_GATE_VERSION,
  });
}
