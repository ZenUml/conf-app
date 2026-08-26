import { Component } from 'vue';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import * as renderPerf from '@/utils/analytics/renderPerf';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';
import {
  applyViewerLoadOutcome,
  getForgeCustomContentId,
  mapThrownViewerLoadError,
  publishDiagramAttribution,
  publishLoadedDiagram,
  setViewerLoadState,
} from '@/utils/viewerLoadOutcome';

export { publishLoadedDiagram };
import type { DiagramLoadError } from '@/model/store2/types';
import type { DiagramAttribution } from '@/model/DiagramAttribution';
import { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
import { getCachedContent, putCachedContent, hashContent } from '@/utils/renderCache/contentCacheStore';

// Slice 1 of the content-opening unification: `loadDiagram` implementations
// are migrating from returning a plain `Diagram | undefined` to the wrapped
// `{ doc, loadError }` shape, so a failed load can carry WHY it failed.
// openDocument callers (forge-swagger-ui.ts) convert their pipeline-level
// OpenError into this store-level DiagramLoadError at their own return
// (mapOpenErrorToLoadError in viewerLoadOutcome.ts) — ONE error vocabulary
// reaches the store and the recovery panel, whichever loader produced it.
export type ViewerLoadDiagramResult =
  | Diagram
  | undefined
  | {
      doc?: Diagram;
      loadError?: DiagramLoadError | null;
      attribution?: DiagramAttribution | null;
    };

export interface ViewerBootstrapOptions {
  macroKind: MacroKind;
  content: Component;
  contentProps?: Record<string, unknown>;
  loadDiagram: () => Promise<ViewerLoadDiagramResult>;
  afterLoad?: (doc: Diagram | undefined) => void | Promise<void>;
  onError?: (error: unknown) => void;
  /**
   * Content-SWR opt-in (see utils/renderCache/contentCacheStore.ts and the
   * "Content SWR" block in forgeIndex.ts, which this mirrors for the
   * graph/openapi/embed viewers). Extracts the customContentId that
   * `loadDiagram` will fetch, from the already-resolved Forge context —
   * BEFORE any fetch runs. Must resolve the SAME id `loadDiagram` uses (e.g.
   * forge-swagger-ui.ts: `context.extension?.config?.customContentId ||
   * context.extension?.modal?.customContentId`).
   *
   * Omitted, or resolving to undefined, is exactly today's behavior: no
   * cache read or write, NULL_DIAGRAM shell, loadDiagram on the critical
   * path.
   */
  resolveContentId?: (context: any) => string | undefined;
}

function normalizeViewerLoadResult(
  result: ViewerLoadDiagramResult,
): { doc?: Diagram; loadError?: DiagramLoadError | null; attribution?: DiagramAttribution | null } {
  if (result && typeof result === 'object' && 'doc' in result) {
    return {
      doc: result.doc,
      loadError: result.loadError ?? null,
      attribution: result.attribution ?? null,
    };
  }
  return { doc: result as Diagram | undefined, loadError: null, attribution: null };
}

export async function bootstrapForgeViewer(options: ViewerBootstrapOptions): Promise<void> {
  try {
    await globals.apWrapper.initializeContext();
    if (globals.apWrapper.isDisplayMode()) {
      setViewerLoadState('loading', null);
    }
    const paywalled = await tryFullscreenViewerPaywall({
      doc: NULL_DIAGRAM,
      content: options.content,
      contentProps: options.contentProps,
      macroKind: options.macroKind,
    });

    // ── Content SWR: cache-first render on a viewer revisit ──────────────────
    // Mirrors the sequence-family block in forgeIndex.ts (measured there:
    // ~66% of viewer views are a revisit of unchanged content, and the view's
    // time is dominated by the content fetch — ~300ms median for
    // graph/openapi, larger at p90). Scoped to the SAME condition as the
    // plain NULL_DIAGRAM mount below — never the paywalled fullscreen
    // surface, which must keep tryFullscreenViewerPaywall as the gate the
    // user actually sees first. `resolveContentId` is optional so a caller
    // that omits it, or whose id resolves to undefined this render (e.g. the
    // embed viewer's legacy-uuid recovery path, which has no id to key on),
    // gets exactly today's behavior below.
    let customContentId: string | undefined;
    // Board and Diagram are independent persisted documents. A cached
    // Diagram-era document must never satisfy a Board load: doing so would
    // hide a missing/empty/malformed boardGraphXml until the background
    // revalidation finishes (or forever if it fails). Board viewers therefore
    // stay on the authoritative load path, where the mode-specific loader can
    // fail fast.
    const isBoardGraph = options.macroKind === 'graph'
      && options.contentProps?.graphEditorMode === 'board';
    if (!paywalled) {
      if (!isBoardGraph) {
        customContentId = options.resolveContentId
          ? options.resolveContentId(await initForgeContext())
          : undefined;
        if (customContentId) {
          const cached = getCachedContent(customContentId);
          if (cached) {
            try {
              const cachedDoc = JSON.parse(cached.doc) as Diagram;
              // Mount the cached doc instead of the NULL_DIAGRAM shell, then
              // publish it through the SAME normalization path a live fetch
              // uses (normalizeCompressedGraphDoc) — the cache stores the RAW
              // doc (see the putCachedContent call below), so a legacy
              // compressed graph body is decompressed here exactly as it would
              // be on a live load.
              mountRoot(cachedDoc, options.content, options.contentProps);
              publishLoadedDiagram(cachedDoc);
              renderPerf.markContentSource('swr_cache');
              // Revalidate in the background — never awaited on the critical
              // path. `afterLoad` (orphan reporting is inline in loadDiagram;
              // attachment backfill needs a real fetch result) is deferred to
              // the revalidate's own completion, same reasoning as forgeIndex.
              void revalidateViewer(customContentId, cached.hash, options);
              return; // rendered from cache — skip the live-fetch + mount path entirely
            } catch (e) {
              console.warn('[content-swr] cache hit failed to render; falling back to live fetch', e);
              // fall through to the normal fetch path below
            }
          }
        }
      }
      mountRoot(NULL_DIAGRAM, options.content, options.contentProps);
    }

    // #413: `fetch_ms` has to belong to whoever actually fetches. forgeIndex
    // used to load the doc for graph/openapi/embed as well, and its own
    // `renderPerf.time('fetch', …)` was the only place the phase was recorded.
    // Once that redundant load was gated to the sequence family the phase went
    // dark for exactly the two slowest macro types — graph and openapi kept
    // reporting cc_fetch/adf_scan (recorded inside ApWrapper2) but lost their
    // parent, so `duration_ms` could no longer be attributed.
    //
    // Scope is content resolution only: the deferred PNG/attachment work runs
    // in `afterLoad`, outside the timer. `renderPerf.time` is first-wins, so
    // the sequence family — which never bootstraps through here — is untouched.
    const loadResult = normalizeViewerLoadResult(
      await renderPerf.time('fetch', () => options.loadDiagram()),
    );
    const doc = applyViewerLoadOutcome({
      doc: loadResult.doc,
      loadError: loadResult.loadError,
      customContentId: getForgeCustomContentId(),
      macroKind: options.macroKind,
    });
    publishDiagramAttribution(loadResult.attribution);
    if (customContentId && loadResult.doc) {
      // Prime the id-keyed SWR cache so a later viewer revisit can render
      // before the fetch. Cache the RAW fetched value (pre-normalization —
      // publishLoadedDiagram's normalizeCompressedGraphDoc runs on every
      // publish, cache hit included above) so its hash matches a future
      // fetch's raw value for change detection.
      putCachedContent(customContentId, JSON.stringify(loadResult.doc));
      renderPerf.markContentSource('fetch');
    }
    await options.afterLoad?.(doc);
  } catch (error) {
    if (globals.apWrapper.isDisplayMode()) {
      applyViewerLoadOutcome({
        doc: undefined,
        loadError: mapThrownViewerLoadError(error),
        customContentId: getForgeCustomContentId(),
        macroKind: options.macroKind,
      });
    }
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  }
}

/**
 * Background revalidate for a content-SWR cache hit: re-runs the real
 * `loadDiagram` fetch (still timed as the `fetch` phase — graph/openapi have
 * no other owner for it, see the #413 comment above), compares against the
 * cached hash, and only republishes when the content actually changed. A
 * failed or empty fetch leaves the cached render standing — never throws,
 * never calls `onError` (this runs off the critical path; the user already
 * has a valid render).
 */
async function revalidateViewer(
  customContentId: string,
  cachedHash: string,
  options: ViewerBootstrapOptions,
): Promise<void> {
  try {
    const loadResult = normalizeViewerLoadResult(
      await renderPerf.time('fetch', () => options.loadDiagram()),
    );
    publishDiagramAttribution(loadResult.attribution);
    // content unreadable now (undefined doc, or a structured loadError with no
    // doc) — keep the last-known-good cached render rather than publish a miss.
    if (!loadResult.doc) return;
    const serialized = JSON.stringify(loadResult.doc);
    putCachedContent(customContentId, serialized);
    if (hashContent(serialized) !== cachedHash) {
      renderPerf.markContentSource('fetch');
      publishLoadedDiagram(loadResult.doc);
    }
    await options.afterLoad?.(loadResult.doc);
  } catch (e) {
    console.warn('[content-swr] background revalidate failed; cached render stands', e);
  }
}
