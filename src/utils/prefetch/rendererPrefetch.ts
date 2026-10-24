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
 * Never throws. Runs at most once per deploy per browser profile — see
 * throttle.ts. The dedicated renderer_prefetch_started/_completed Mixpanel
 * events were removed 2026-09-02 (sampled to 0 — warm-vs-cold render is
 * already measured via macro_viewed.cache_state); this comment is the only
 * remaining trace of that telemetry.
 *
 * No feature flag: this ran at 100% on lite and diagramly from June 2026 and
 * the `renderer-prefetch` / `renderer-prefetch-banner` Forge flags were retired
 * 2026-07-25. Consequence — there is no longer a no-release kill switch, and
 * full/asyncapi (which never had the flags, so never prefetched) now do. The
 * remaining runtime brakes are the guards in readGuards (saveData, 2g,
 * hidden tab, deviceMemory for the import-warm) and the once-per-deploy
 * throttle.
 */

import { DRAWIO_PREFETCH_ASSETS } from '@/utils/drawio/loadDrawioViewer';
import { loadMermaid } from '@/utils/mermaid/loadMermaid';
import { getBuildKey, isPrefetchDone, isPrefetchDue, markPrefetchDone, tryClaimLock, releaseLock, type KvStore } from './throttle';

export { isPrefetchDue };
import { prefetchUrls, fetchPrefetchManifest, type PrefetchResult, type PrefetchManifest } from './prefetchAssets';

// Local now that the renderer_prefetch_started/_completed telemetry (and its
// catalog.ts PrefetchHost/PrefetchOutcome types) is gone — these describe the
// still-live prefetch mechanics, not any analytics payload.
export type PrefetchHost = 'macro' | 'banner';
export type PrefetchOutcome = 'completed' | 'partial' | 'failed' | 'timed_out';

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
  getManifest?: () => Promise<PrefetchManifest>;
  prefetch?: typeof prefetchUrls;
  warmMermaid?: () => Promise<unknown>;
}

export interface Guards {
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

  const deadlineMs = opts.deadlineMs ?? 30_000;
  let attempted = false;
  try {
    attempted = true;
    const exclude = new Set(opts.excludeRenderers ?? []);
    const renderers = ALL_RENDERERS.filter((r) => !exclude.has(r));

    await withDeadline(
      executePrefetch(renderers, guards, deadlineMs, opts, now),
      deadlineMs,
    );
  } finally {
    // A failed/timed-out attempt is not retried until the next deploy: this
    // is an optimization, and retry storms cost users real bandwidth.
    if (attempted) markPrefetchDone(buildKey, store);
    releaseLock(store);
  }
}

export interface ExecOutcome {
  outcome: PrefetchOutcome;
  requested: number;
  failed: number;
}

export async function executePrefetch(
  renderers: readonly PrefetchRenderer[],
  guards: Guards,
  deadlineMs: number,
  opts: RunOptions,
  now: () => number,
): Promise<ExecOutcome> {
  const startedAt = now();
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
    timeoutMs: Math.max(deadlineMs - (now() - startedAt), 0),
    ...(opts.doc ? { doc: opts.doc } : {}),
  });

  let requested = linkResult.requested;
  let failed = linkResult.failed;
  let timedOut = linkResult.timedOut;

  // Import-warm goes through the real loader (singleton, idempotent), pulling
  // the entry AND its static-import chunks — which a bare <link rel=prefetch>
  // would miss. Costs one-off parse/execute in this hidden/idle iframe, so
  // it's gated on deviceMemory. Raced against the remaining deadline budget —
  // loadMermaid has no timeout of its own and the banner host is holding
  // view.close() while we wait.
  if (renderers.includes('mermaid') && guards.allowImportWarm) {
    requested++;
    const remaining = Math.max(deadlineMs - (now() - startedAt), 0);
    try {
      const warm = opts.warmMermaid ?? loadMermaid;
      const warmResult = await Promise.race([
        warm().then(() => 'warmed' as const),
        new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), remaining)),
      ]);
      if (warmResult === 'timed_out') {
        failed++;
        timedOut = true;
      }
    } catch {
      failed++;
    }
  }

  const outcome: PrefetchOutcome =
    failed === 0 && !timedOut ? 'completed' : failed >= requested ? 'failed' : 'partial';
  return { outcome, requested, failed };
}

function withDeadline(work: Promise<ExecOutcome>, deadlineMs: number): Promise<ExecOutcome> {
  // 'timed_out': the deadline fired before any per-asset result arrived —
  // distinct from 'partial'/'failed', which carry real counts.
  const fallback: ExecOutcome = { outcome: 'timed_out', requested: 0, failed: 0 };
  return Promise.race([
    work,
    // Grace over the inner per-step timeouts so the inner settle (with real
    // counts) normally wins; this race is the backstop for a hung manifest
    // fetch (the only inner await without its own budget).
    new Promise<ExecOutcome>((resolve) => setTimeout(() => resolve(fallback), deadlineMs + 2_000)),
  ]);
}
