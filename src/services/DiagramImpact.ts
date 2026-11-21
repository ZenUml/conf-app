import { callRemote } from '@/utils/requestUtil';

export interface DiagramImpactSummary {
  audienceCount: number;
  viewerRelation: 'creator' | 'updater' | 'contributor' | 'viewer';
}

export async function getDiagramImpact(customContentId: string): Promise<DiagramImpactSummary> {
  return callRemote(`/api/diagram-impact?customContentId=${encodeURIComponent(customContentId)}`, 'GET');
}

export type RegistrationResult = 'new_unique' | 'repeat' | 'excluded_contributor' | 'write_failed';

export interface DiagramImpactRegistration {
  audienceCount: number;
  result?: RegistrationResult;
}

export async function registerDiagramImpactView(customContentId: string): Promise<DiagramImpactRegistration> {
  return callRemote('/api/diagram-impact/view', 'POST', { customContentId });
}
