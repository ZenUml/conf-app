import {
  getClientDomain,
} from "@/utils/ContextParameters/ContextParameters";

const InteeralDomains = ['whimet4', 'zenuml-stg'];

export const enum FeatureSwitch {
  DIAGRAM_LIKE = 'diagram-like',
};

export async function isFeatureEnabled(featureName: FeatureSwitch): Promise<boolean> {
  const clientDomain = getClientDomain();
  if (clientDomain && InteeralDomains.includes(clientDomain)) {
    return true;
  }

  //TODO: Check feature switch from KV store
  return false;
}
