/**
 * Shared environment mapping for the @forge/bridge client-side FeatureFlags SDK.
 *
 * Forge context reports DEVELOPMENT/STAGING/PRODUCTION; the SDK wants
 * lowercase. Unknown/missing maps to 'production', where a flag is off until
 * explicitly configured — the fail-closed direction.
 *
 * Lived in utils/prefetch/flags.ts until the renderer-prefetch flags were
 * retired (2026-07-25); moved here so the surviving flag modules
 * (renderGate, stalenessHint) don't import from a feature they don't use.
 */

export type FeatureFlagEnvironment = 'development' | 'staging' | 'production';

export function mapEnvironment(environmentType: unknown): FeatureFlagEnvironment {
  const env = typeof environmentType === 'string' ? environmentType.toLowerCase() : '';
  return env === 'development' || env === 'staging' ? env : 'production';
}
