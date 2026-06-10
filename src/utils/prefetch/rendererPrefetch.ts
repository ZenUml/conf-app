/**
 * Idle renderer-bundle prefetch (EAG-64).
 *
 * Warms the shared per-deploy HTTP cache for heavy renderer bundles so a
 * LATER macro render hits a warm cache. Success shows up automatically as
 * macro_viewed.cache_state flipping cold→warm (trackRenderTime.ts) — no new
 * render-time instrumentation.
 *
 * Two hosts call this:
 *  - 'macro'  — an alive macro iframe, scheduled at idle after its own render
 *               settled (trackRenderTime). Warms the OTHER renderer families.
 *  - 'banner' — the zenuml-page-banner iframe on its no-banner fast-path
 *               (forgeIndex), which covers pages with no macros at all. The
 *               banner is about to view.close(), so the caller passes a
 *               deadline and we stop waiting (not downloading) when it hits.
 *
 * Coverage: DrawIO (stable public/ URLs — the 4.2MB documented cold-load
 * pain), ZenUML + OpenAPI (hashed chunks via the build-emitted
 * prefetch-manifest.json), Mermaid (import-warm through the real loadMermaid
 * singleton — a <link rel=prefetch> of the entry would NOT fetch its static
 * import chunks). PlantUML renders server-side; nothing to prefetch.
 *
 * Never throws. Fires analytics only on an actual attempt (≤1 per deploy per
 * browser profile — see throttle.ts), never on the skip path.
 */

import { DRAWIO_PREFETCH_ASSETS } from '@/utils/drawio/loadDrawioViewer';
import { loadMermaid } from '@/utils/mermaid/loadMermaid';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { PrefetchHost, PrefetchOutcome } from '@/utils/analytics/catalog';
import { getBuildKey, isPrefetchDone, isPrefetchDue, markPrefetchDone, tryClaimLock, releaseLock, type KvStore } from './throttle';

export { isPrefetchDue };
import { getPrefetchFlags, type PrefetchFlags } from './flags';
import { prefetchUrls, fetchPrefetchManifest, type PrefetchResult, type PrefetchManifest } from './prefetchAssets';

export type PrefetchRenderer = 'graph' | 'mermaid' | 'sequence' | 'openapi';

const ALL_RENDERERS: readonly PrefetchRenderer[] = ['graph', 'sequence', 'openapi', 'mermaid'];
const MIN_DEVICE_MEMORY_FOR_IMPORT_WARM = 4;

export interface RunOptions {
  host: PrefetchHost;
  /** The calling iframe's own renderer family — already loaded, skip it. */
  excludeRenderers?: readonly PrefetchRenderer[];
  /** Stop waiting after this long (banner host: bounds the view.close delay). */
  deadlineMs?: number;
  // Injection points for tests.
  store?: KvStore;
  nav?: Partial<Navigator> & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
  doc?: Document;
  now?: () => number;
  getFlags?: (host: PrefetchHost) => Promise<boolean>;
  getManifest?: () => Promise<PrefetchManifest>;
  prefetch?: typeof prefetchUrls;
  warmMermaid?: () => Promise<unknown>;
  track?: typeof trackAnalyticsEvent;
}

interface Guards {
  saveData: boolean;
  effectiveType?: string;
  allowImportWarm: boolean;
  visible: boolean;
}

function readGuards(opts: RunOptions): Guards {
  const nav = (opts.nav ?? (typeof navigator !== 'undefined' ? navigator : {})) as NonNullable<RunOptions['nav']>;
  const doc = opts.doc ?? document;
  const connection = nav.connection;
  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType,
    // Absent APIs default to allow (Safari has neither NetworkInformation
    // nor deviceMemory) — matches the repo's graceful-degradation pattern.
    allowImportWarm: !(typeof nav.deviceMemory === 'number' && nav.deviceMemory < MIN_DEVICE_MEMORY_FOR_IMPORT_WARM),
    visible: doc.visibilityState !== 'hidden',
  };
}

export async function runRendererPrefetchIfDue(opts: RunOptions): Promise<void> {
  try {
    await run(opts);
  } catch (e) {
    // Optimization only — never let it surface to a render or close path.
    console.warn('[renderer-prefetch] failed', e);
  }
}

async function run(opts: RunOptions): Promise<void> {
  const now = opts.now ?? Date.now;
  const store = opts.store;
  const buildKey = getBuildKey();

  if (isPrefetchDone(buildKey, store)) return;

  const guards = readGuards(opts);
  if (guards.saveData) return;
  if (guards.effectiveType === 'slow-2g' || guards.effectiveType === '2g') return;
  if (!guards.visible) return;

  if (!tryClaimLock(now(), store)) return;

  let attempted = false;
  try {
    const flagEnabled = opts.getFlags
      ? await opts.getFlags(opts.host)
      : await defaultFlagCheck(opts.host);
    if (!flagEnabled) return;

    attempted = true;
    const startedAt = now();
    const exclude = new Set(opts.excludeRenderers ?? []);
    const renderers = ALL_RENDERERS.filter((r) => !exclude.has(r));
    const track = opts.track ?? trackAnalyticsEvent;

    track('renderer_prefetch_started', {
      feature_area: 'system',
      surface: opts.host === 'banner' ? 'page_banner' : 'viewer',
      prefetch_host: opts.host,
      prefetch_renderers: renderers.join(','),
      ...(guards.effectiveType ? { effective_type: guards.effectiveType } : {}),
      save_data: guards.saveData,
    });

    const deadlineMs = opts.deadlineMs ?? 30_000;
    const outcome = await withDeadline(
      executePrefetch(renderers, guards, deadlineMs, opts),
      deadlineMs,
    );

    track('renderer_prefetch_completed', {
      feature_area: 'system',
      surface: opts.host === 'banner' ? 'page_banner' : 'viewer',
      prefetch_host: opts.host,
      prefetch_renderers: renderers.join(','),
      prefetch_outcome: outcome.outcome,
      prefetch_assets_count: outcome.requested,
      prefetch_failed_count: outcome.failed,
      prefetch_duration_ms: now() - startedAt,
    });
  } finally {
    // A failed/timed-out attempt is not retried until the next deploy: this
    // is an optimization, and retry storms cost users real bandwidth.
    if (attempted) markPrefetchDone(buildKey, store);
    releaseLock(store);
  }
}

async function defaultFlagCheck(host: PrefetchHost): Promise<boolean> {
  const flags: PrefetchFlags = await getPrefetchFlags();
  return host === 'banner' ? flags.bannerHost : flags.macroHost;
}

interface ExecOutcome {
  outcome: PrefetchOutcome;
  requested: number;
  failed: number;
}

async function executePrefetch(
  renderers: readonly PrefetchRenderer[],
  guards: Guards,
  deadlineMs: number,
  opts: RunOptions,
): Promise<ExecOutcome> {
  const paths: string[] = [];
  if (renderers.includes('graph')) paths.push(...DRAWIO_PREFETCH_ASSETS);

  if (renderers.includes('sequence') || renderers.includes('openapi')) {
    const getManifest = opts.getManifest ?? fetchPrefetchManifest;
    const manifest = await getManifest();
    if (renderers.includes('sequence')) paths.push(...(manifest.renderers.sequence ?? []));
    if (renderers.includes('openapi')) paths.push(...(manifest.renderers.openapi ?? []));
  }

  const prefetch = opts.prefetch ?? prefetchUrls;
  const linkResult: PrefetchResult = await prefetch(paths, {
    timeoutMs: deadlineMs,
    ...(opts.doc ? { doc: opts.doc } : {}),
  });

  let requested = linkResult.requested;
  let failed = linkResult.failed;

  // Import-warm goes through the real loader (singleton, idempotent), pulling
  // the entry AND its static-import chunks — which a bare <link rel=prefetch>
  // would miss. Costs one-off parse/execute in this hidden/idle iframe, so
  // it's gated on deviceMemory.
  if (renderers.includes('mermaid') && guards.allowImportWarm) {
    requested++;
    try {
      const warm = opts.warmMermaid ?? loadMermaid;
      await warm();
    } catch {
      failed++;
    }
  }

  const outcome: PrefetchOutcome =
    failed === 0 && !linkResult.timedOut ? 'completed' : failed >= requested ? 'failed' : 'partial';
  return { outcome, requested, failed };
}

function withDeadline(work: Promise<ExecOutcome>, deadlineMs: number): Promise<ExecOutcome> {
  const fallback: ExecOutcome = { outcome: 'partial', requested: 0, failed: 0 };
  return Promise.race([
    work,
    // Grace over the inner timeout so the inner settle (with real counts)
    // normally wins; this race only catches a hung manifest/flag fetch.
    new Promise<ExecOutcome>((resolve) => setTimeout(() => resolve(fallback), deadlineMs + 2_000)),
  ]);
}
