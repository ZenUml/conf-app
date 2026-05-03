import { FeatureFlag, FeatureFlags, FeatureContext, FeatureEvaluationResult } from '../types/feature-flags';
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters';

export class FeatureService {
  private flags: FeatureFlags | null = null;
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async isFeatureEnabled(featureName: string, context?: FeatureContext): Promise<boolean> {
    const result = await this.evaluateFeature(featureName, context);
    return result.enabled;
  }

  async evaluateFeature(featureName: string, context?: FeatureContext): Promise<FeatureEvaluationResult> {
    if (!this.flags || Date.now() - this.lastFetchTime > this.CACHE_TTL) {
      await this.loadFlags();
    }

    const feature = this.flags?.flags[featureName];
    if (!feature) {
      const result = { enabled: false, reason: 'DISABLED' as const };
      await this.recordEvaluation(featureName, context, result);
      return result;
    }

    if (!feature.enabled) {
      const result = { enabled: false, reason: 'DISABLED' as const };
      await this.recordEvaluation(featureName, context, result);
      return result;
    }

    const clientDomain = context?.clientDomain || getClientDomain();
    if (!clientDomain) {
      const result = { enabled: feature.rules.default, reason: 'DEFAULT' as const };
      await this.recordEvaluation(featureName, context, result);
      return result;
    }

    // Check domain rules
    if (feature.rules.domains) {
      if (feature.rules.domains.exclude?.includes(clientDomain)) {
        const result = { enabled: false, reason: 'DOMAIN_EXCLUDE' as const };
        await this.recordEvaluation(featureName, context, result);
        return result;
      }
      if (feature.rules.domains.include?.includes(clientDomain)) {
        const result = { enabled: true, reason: 'DOMAIN_INCLUDE' as const };
        await this.recordEvaluation(featureName, context, result);
        return result;
      }
    }

    const result = { enabled: feature.rules.default, reason: 'DEFAULT' as const };
    try {
      await this.recordEvaluation(featureName, context, result);
    } catch (error) {
      console.error('Failed to record feature evaluation:', error);
    }
    return result;
  }

  private async loadFlags(): Promise<void> {
    try {
      const response = await fetch(`${window.location.origin}/api/features`);
      if (!response.ok) {
        throw new Error(`Failed to load feature flags: ${response.statusText}`);
      }
      this.flags = await response.json();
      this.lastFetchTime = Date.now();
    } catch (error) {
      console.error('Error loading feature flags:', error);
      // Initialize with empty flags if fetch fails
      this.flags = {
        metadata: {
          version: '1.0.0',
          lastUpdated: new Date().toISOString()
        },
        flags: {}
      };
    }
  }

  private async recordEvaluation(
    featureName: string,
    context: FeatureContext | undefined,
    result: FeatureEvaluationResult
  ): Promise<void> {
    try {
      await fetch(`${window.location.origin}/api/metrics/evaluation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          feature: featureName,
          enabled: result.enabled,
          timestamp: new Date().toISOString(),
          context: {
            clientDomain: context?.clientDomain || getClientDomain(),
            userId: context?.userId
          },
          result: {
            reason: result.reason
          }
        })
      });
    } catch (error) {
      console.error('Failed to record feature evaluation:', error);
    }
  }
}

// Export a singleton instance
export const featureService = new FeatureService(); 