import { callRemote } from '@/utils/requestUtil';

export interface DiagramImpactSummary {
  audienceCount: number;
  viewerRelation: 'creator' | 'updater' | 'contributor' | 'viewer';
}

export async function getDiagramImpact(customContentId: string): Promise<DiagramImpactSummary> {
  return callRemote(`/api/diagram-impact?customContentId=${encodeURIComponent(customContentId)}`, 'GET');
}

export async function registerDiagramImpactView(customContentId: string): Promise<Pick<DiagramImpactSummary, 'audienceCount'>> {
  return callRemote('/api/diagram-impact/view', 'POST', { customContentId });
}
