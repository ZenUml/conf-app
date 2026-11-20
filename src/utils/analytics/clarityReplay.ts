/**
 * Microsoft Clarity session replay for the editor and fullscreen iframes.
 *
 * Privacy contract (stated on the Marketplace Privacy & Security tab):
 * - `content: false` masks all text and images, so diagram source, titles and
 *   rendered labels never leave the browser.
 * - `track: false` sets no Clarity cookies and denies ad/analytics storage.
 * - No `clarity.identify`: no Atlassian account ID is sent to Microsoft.
 *   The referrer_domain custom tag contains only the Forge site hostname.
 * - Visitors in the EEA, UK and Switzerland are never recorded: the
 *   stats.zenuml.com Worker answers /clarity/allow from the visitor's country,
 *   and any failure to get a yes means no recording.
 *
 * Network: the SDK is bundled from npm and uploads to stats.zenuml.com, which
 * forwards to s.clarity.ms. The manifest already allows https://*.zenuml.com,
 * so no egress host is added (an added host makes a major Forge version).
 *
 * Rollout: the `clarity-replay-enabled` Forge flag (Lite only). Other variants
 * have no such flag, so `checkFlag` returns the default false.
 */
import { getContext } from "@/model/globals/forgeGlobal";
import { mapEnvironment } from "@/utils/forgeFlagEnvironment";
import type { ClarityReplayOutcome } from "./catalog";

export const CLARITY_FLAG = "clarity-replay-enabled";
// Public project id (it appears in every page that runs Clarity).
export const CLARITY_PROJECT_ID = "zg2ym7yzjh";
export const CLARITY_PROXY = "https://stats.zenuml.com";
const GEO_CACHE_KEY = "zenuml.clarityGeoAllow";
const GEO_TIMEOUT_MS = 2000;
const SESSION_ID_TIMEOUT_MS = 5000;

export interface ClarityReplayResult {
  outcome: ClarityReplayOutcome;
  sessionId?: string;
}

interface ForgeContextLike {
  cloudId?: string;
  accountId?: string;
  environmentType?: string;
  siteUrl?: string;
  moduleKey?: string;
  extension?: {
    modal?: { macroMode?: string };
    macro?: { isConfiguring?: boolean };
  };
}

interface FlagClient {
  initialize(
    user: {
      attributes?: Record<string, string | number>;
      identifiers?: { installContext?: string; accountId?: string };
    },
    config?: { environment: "development" | "staging" | "production" },
  ): Promise<void>;
  checkFlag(flagName: string, defaultValue?: boolean): boolean;
  shutdown(): void;
}

interface ClarityLike {
  start(config: Record<string, unknown>): void;
  set(key: string, value: string): void;
  metadata(cb: (data: { sessionId?: string }) => void, wait?: boolean): void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface ClarityReplayDeps {
  getForgeContext?: () => Promise<ForgeContextLike | undefined>;
  createFlagClient?: () => Promise<FlagClient>;
  fetchGeo?: () => Promise<boolean>;
  loadClarity?: () => Promise<ClarityLike>;
  storage?: StorageLike | null;
}

export function clarityReplaySurface(context: ForgeContextLike | undefined): "editor" | "fullscreen" | undefined {
  const macroMode = context?.extension?.modal?.macroMode;
  if (macroMode === "editor" || context?.extension?.macro?.isConfiguring) return "editor";
  if (macroMode === "fullscreen") return "fullscreen";
  return undefined;
}

async function defaultCreateFlagClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import("@forge/bridge");
  return new FeatureFlags() as unknown as FlagClient;
}

async function defaultFetchGeo(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(`${CLARITY_PROXY}/clarity/allow`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { allow?: unknown };
    return body.allow === true;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultLoadClarity(): Promise<ClarityLike> {
  const { clarity } = await import("clarity-js");
  return clarity as unknown as ClarityLike;
}

function siteHostname(siteUrl: string | undefined): string | undefined {
  if (!siteUrl) return undefined;
  try {
    const url = new URL(siteUrl);
    return url.protocol === "https:" ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

async function isFlagOn(context: ForgeContextLike, createClient: () => Promise<FlagClient>): Promise<boolean> {
  if (!context.cloudId) return false;
  let client: FlagClient | undefined;
  try {
    client = await createClient();
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${context.cloudId}` },
        identifiers: { accountId: context.accountId },
      },
      { environment: mapEnvironment(context.environmentType) },
    );
    return client.checkFlag(CLARITY_FLAG, false);
  } catch {
    return false;
  } finally {
    try {
      client?.shutdown();
    } catch {
      // best-effort cleanup
    }
  }
}

async function isGeoAllowed(fetchGeo: () => Promise<boolean>, storage: StorageLike | null): Promise<boolean> {
  try {
    const cached = storage?.getItem(GEO_CACHE_KEY);
    if (cached === "1") return true;
    if (cached === "0") return false;
  } catch {
    // storage unavailable: ask the Worker
  }
  let allow = false;
  try {
    allow = await fetchGeo();
  } catch {
    allow = false;
  }
  try {
    storage?.setItem(GEO_CACHE_KEY, allow ? "1" : "0");
  } catch {
    // caching is optional
  }
  return allow;
}

function readSessionId(clarity: ClarityLike): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), SESSION_ID_TIMEOUT_MS);
    try {
      clarity.metadata((data) => {
        clearTimeout(timer);
        resolve(data?.sessionId || undefined);
      }, true);
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

let started: Promise<ClarityReplayResult> | null = null;

/** Starts Clarity at most once per iframe. Never rejects. */
export function startClarityReplay(deps: ClarityReplayDeps = {}): Promise<ClarityReplayResult> {
  if (!started) started = run(deps);
  return started;
}

/** Test hook. */
export function _resetClarityReplayForTests(): void {
  started = null;
}

async function run(deps: ClarityReplayDeps): Promise<ClarityReplayResult> {
  let context: ForgeContextLike | undefined;
  try {
    context = await (deps.getForgeContext ?? (getContext as () => Promise<ForgeContextLike | undefined>))();
  } catch {
    context = undefined;
  }
  const surface = clarityReplaySurface(context);
  if (!context || !surface) return { outcome: "skipped_surface" };

  if (!(await isFlagOn(context, deps.createFlagClient ?? defaultCreateFlagClient))) {
    return { outcome: "skipped_flag" };
  }

  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  if (!(await isGeoAllowed(deps.fetchGeo ?? defaultFetchGeo, storage))) {
    return { outcome: "skipped_geo" };
  }

  try {
    const clarity = await (deps.loadClarity ?? defaultLoadClarity)();
    clarity.start({
      projectId: CLARITY_PROJECT_ID,
      upload: `${CLARITY_PROXY}/clarity/collect`,
      track: false,
      content: false,
    });
    clarity.set("surface", surface);
    const environment = context.environmentType?.toLowerCase();
    if (environment === "production" || environment === "staging" || environment === "development") {
      clarity.set("environment", environment);
    }
    const hostname = siteHostname(context.siteUrl);
    if (hostname) clarity.set("referrer_domain", hostname);
    if (context.moduleKey) clarity.set("moduleKey", context.moduleKey);
    const sessionId = await readSessionId(clarity);
    return { outcome: "started", sessionId };
  } catch {
    return { outcome: "failed" };
  }
}
