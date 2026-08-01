/**
 * Feature-flag registry — the single source of truth for WHICH flag lives on
 * WHICH provider. Every runtime toggle in this app is declared here; consumer
 * modules import their key from this file instead of re-declaring the string.
 *
 * Two providers, chosen by what the flag needs (full decision framework:
 * docs/policies/feature-flags.md):
 *
 * - `forge` — Atlassian Forge feature flags, evaluated CLIENT-SIDE via the
 *   @forge/bridge FeatureFlags SDK. Boolean only, fail-closed (`checkFlag`
 *   default `false` at every call site). Per-app inventory: lite / full /
 *   diagramly / asyncapi are separate Forge apps, each capped at
 *   {@link FORGE_FLAG_LIMIT_PER_APP} flags. Toggled in the Developer Console
 *   (no deploy); supports env targeting, percentage rollout, and per-install
 *   targeting via `installContext`. Not reachable from our Cloudflare backend.
 *
 * - `cloudflare-kv` — Cloudflare KV records served by our Pages Functions
 *   (`functions/feature-flags.ts` reads the `KV_FEATURE_FLAGS` namespace).
 *   Values are arbitrary JSON keyed per client domain, evaluated SERVER-SIDE
 *   and fetched by the frontend through `src/apis/featureFlags.ts`. Unlimited
 *   count, operator-managed via `wrangler kv`. Depends on our backend being
 *   reachable — so never gate rendering itself on a KV flag (CLAUDE.md:
 *   Confluence storage must suffice for render/edit).
 */

export type FlagProvider = 'forge' | 'cloudflare-kv';

/** Who a single flag evaluation is scoped to. */
export type FlagScope =
  /** Forge install (site) + accountId — the Forge SDK bucketing identity. */
  | 'site-user'
  /** The Confluence tenant domain (`<tenant>.atlassian.net`). */
  | 'client-domain';

export interface FlagDefinition {
  /** Exact key as it exists on the provider (Console flag key or KV entry). */
  readonly key: string;
  readonly provider: FlagProvider;
  readonly scope: FlagScope;
  /** What turning the flag ON does. All flags are fail-closed: off/absent/error = today's behavior. */
  readonly description: string;
  /** Module that evaluates the flag — the place to read for exact semantics. */
  readonly module: string;
}

/**
 * Forge Console flag keys. Add a key here FIRST when introducing a Forge
 * flag; the Console flag itself is created per app via the
 * `forge-feature-flag` skill.
 */
export const FORGE_FLAGS = {
  aiTitle: 'ai-title-enabled',
  aiRepair: 'ai-repair-enabled',
  agentLink: 'agent-link-enabled',
  viewportGatedRender: 'viewport-gated-render',
  stalenessHint: 'editor-staleness-hint-enabled',
  sessionReplay: 'session-replay',
  sessionReplayFull: 'session-replay-full',
} as const;

/** Cloudflare KV flag keys served by `functions/feature-flags.ts`. */
export const KV_FLAGS = {
  customerSuccessService: 'CUSTOMER_SUCCESS_SERVICE',
} as const;

export type ForgeFlagKey = (typeof FORGE_FLAGS)[keyof typeof FORGE_FLAGS];
export type KvFlagKey = (typeof KV_FLAGS)[keyof typeof KV_FLAGS];

/**
 * Hard platform cap on Forge flags PER APP (hit on lite, 2026-07-25). A new
 * Forge flag may require retiring an old one first — and deleting a live
 * flag makes `checkFlag` return its default (`false` everywhere here), so
 * remove the code gate and release BEFORE deleting a flag that is at 100%.
 */
export const FORGE_FLAG_LIMIT_PER_APP = 10;

export const FEATURE_FLAG_REGISTRY: readonly FlagDefinition[] = [
  {
    key: FORGE_FLAGS.aiTitle,
    provider: 'forge',
    scope: 'site-user',
    description: 'AI-generated diagram titles in the editor.',
    module: 'src/apis/aiTitleFeatureFlag.ts',
  },
  {
    key: FORGE_FLAGS.aiRepair,
    provider: 'forge',
    scope: 'site-user',
    description:
      'AI Repair flow on diagram syntax errors (SyntaxErrorBox). Reachable in the asyncapi variant via the OpenAPI macro.',
    module: 'src/apis/aiTitleFeatureFlag.ts',
  },
  {
    key: FORGE_FLAGS.agentLink,
    provider: 'forge',
    scope: 'site-user',
    description: 'Live Agent Link — master switch for mounting the agent UI into the macro host.',
    module: 'src/apis/aiTitleFeatureFlag.ts',
  },
  {
    key: FORGE_FLAGS.viewportGatedRender,
    provider: 'forge',
    scope: 'site-user',
    description:
      'Viewer viewport render gate (#382). Read through a 30-min localStorage cache so the bridge round-trip never delays a render.',
    module: 'src/utils/renderGate/flags.ts',
  },
  {
    key: FORGE_FLAGS.stalenessHint,
    provider: 'forge',
    scope: 'site-user',
    description: 'Editor staleness hint banner.',
    module: 'src/utils/stalenessHint/flags.ts',
  },
  {
    key: FORGE_FLAGS.sessionReplay,
    provider: 'forge',
    scope: 'site-user',
    description:
      'Mixpanel session-replay GENERAL sampling — the rollout percentage in the Console IS the live sampling rate.',
    module: 'src/utils/analytics/sessionReplayFlags.ts',
  },
  {
    key: FORGE_FLAGS.sessionReplayFull,
    provider: 'forge',
    scope: 'site-user',
    description:
      'Mixpanel session-replay TARGETED 100% capture for a specific install; wins over the general rate.',
    module: 'src/utils/analytics/sessionReplayFlags.ts',
  },
  {
    key: KV_FLAGS.customerSuccessService,
    provider: 'cloudflare-kv',
    scope: 'client-domain',
    description:
      'Lite paywall enrollment (CSS). KV value is a JSON object keyed by client domain; a domain present in it has the metered paywall active.',
    module: 'src/composables/useCustomerSuccessService.ts',
  },
];

export function getFlagDefinition(key: string): FlagDefinition | undefined {
  return FEATURE_FLAG_REGISTRY.find((f) => f.key === key);
}

export function flagsByProvider(provider: FlagProvider): readonly FlagDefinition[] {
  return FEATURE_FLAG_REGISTRY.filter((f) => f.provider === provider);
}
