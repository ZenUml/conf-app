import { featureService } from './FeatureService';

export const enum FeatureSwitch {
  DIAGRAM_LIKE = 'diagram-like',
}

export async function isFeatureEnabled(featureName: FeatureSwitch): Promise<boolean> {
  return featureService.isFeatureEnabled(featureName);
}

