export interface FeatureFlag {
  name: string;
  description: string;
  enabled: boolean;
  rules: {
    domains?: {
      include?: string[];
      exclude?: string[];
    };
    default: boolean;
  };
}

export interface FeatureFlags {
  metadata: {
    version: string;
    lastUpdated: string;
  };
  flags: {
    [key: string]: FeatureFlag;
  };
}

export interface FeatureContext {
  clientDomain: string;
  userId?: string;
}

export interface FeatureEvaluationResult {
  enabled: boolean;
  reason: 'ENABLED' | 'DISABLED' | 'DOMAIN_INCLUDE' | 'DOMAIN_EXCLUDE' | 'DEFAULT';
} 