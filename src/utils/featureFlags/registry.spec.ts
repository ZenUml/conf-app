import { describe, it, expect } from 'vitest';
import {
  FEATURE_FLAG_REGISTRY,
  FORGE_FLAGS,
  KV_FLAGS,
  FORGE_FLAG_LIMIT_PER_APP,
  flagsByProvider,
  getFlagDefinition,
} from './registry';
import { STALENESS_HINT_FLAG } from '@/utils/stalenessHint/flags';
import { VIEWPORT_GATE_FLAG } from '@/utils/renderGate/flags';
import { FULL_FLAG, SAMPLED_FLAG } from '@/utils/analytics/sessionReplayFlags';
import {
  AI_TITLE_FLAG_ID,
  AI_REPAIR_FLAG_ID,
  AGENT_LINK_FLAG_ID,
} from '@/apis/aiTitleFeatureFlag';

describe('feature-flag registry', () => {
  it('has a unique key per entry', () => {
    const keys = FEATURE_FLAG_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('registers every FORGE_FLAGS / KV_FLAGS key with the matching provider', () => {
    for (const key of Object.values(FORGE_FLAGS)) {
      expect(getFlagDefinition(key)?.provider, key).toBe('forge');
    }
    for (const key of Object.values(KV_FLAGS)) {
      expect(getFlagDefinition(key)?.provider, key).toBe('cloudflare-kv');
    }
    expect(FEATURE_FLAG_REGISTRY.length).toBe(
      Object.values(FORGE_FLAGS).length + Object.values(KV_FLAGS).length,
    );
  });

  it('stays under the per-app Forge flag cap', () => {
    expect(flagsByProvider('forge').length).toBeLessThanOrEqual(FORGE_FLAG_LIMIT_PER_APP);
  });

  it('uses kebab-case for Forge keys and SCREAMING_SNAKE for KV keys', () => {
    for (const f of flagsByProvider('forge')) {
      expect(f.key, f.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    for (const f of flagsByProvider('cloudflare-kv')) {
      expect(f.key, f.key).toMatch(/^[A-Z0-9]+(_[A-Z0-9]+)*$/);
    }
  });

  // Drift guard: the constants each consumer module actually evaluates must be
  // the registry's keys. A consumer that reverts to a string literal (or a
  // registry rename that misses a consumer) fails here, not in production.
  it('matches the keys used by the consumer modules', () => {
    expect(STALENESS_HINT_FLAG).toBe(FORGE_FLAGS.stalenessHint);
    expect(VIEWPORT_GATE_FLAG).toBe(FORGE_FLAGS.viewportGatedRender);
    expect(FULL_FLAG).toBe(FORGE_FLAGS.sessionReplayFull);
    expect(SAMPLED_FLAG).toBe(FORGE_FLAGS.sessionReplay);
    expect(AI_TITLE_FLAG_ID).toBe(FORGE_FLAGS.aiTitle);
    expect(AI_REPAIR_FLAG_ID).toBe(FORGE_FLAGS.aiRepair);
    expect(AGENT_LINK_FLAG_ID).toBe(FORGE_FLAGS.agentLink);
  });
});
