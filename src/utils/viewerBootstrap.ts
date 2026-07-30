import { Component } from 'vue';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import store from '@/model/store2';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { decompress } from '@/utils/compress';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import * as renderPerf from '@/utils/analytics/renderPerf';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';
import { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
import { getCachedContent, putCachedContent } from '@/utils/renderCache/contentCacheStore';
import { revalidateViewerContent } from '@/utils/renderCache/revalidateViewerContent';

export interface ViewerBootstrapOptions {
  macroKind: MacroKind;
  content: Component;
  contentProps?: Record<string, unknown>;
  loadDiagram: () => Promise<Diagram | undefined>;
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

/**
 * Legacy Connect-era graph/DrawIO macros persisted graphXml as LZUTF8-Base64
 * with `compressed: true`. The customContentId load path (ApWrapper2's
 * JSON.parse) preserved that flag without decompressing, so the still-
 * compressed string reached the store and ForgeGraphViewer's
 * `mxUtils.parseXml(<base64>)` threw → blank canvas (the error is swallowed).
 * The content-property recovery path already decompresses inline; this
 * normalizes the customContentId path too, at the single store-write boundary,
 * so the store always holds plain <mxGraphModel> XML regardless of load path.
 *
 * Returns a NEW object when it decompresses, leaving the caller's `doc`
 * reference compressed so afterLoad's compressed_* telemetry still fires on it.
 * No-op for plain XML and for non-graph docs (`compressed` is undefined).
 */
function normalizeCompressedGraphDoc(doc: Diagram | undefined): Diagram | undefined {
  if (doc?.compressed && doc.graphXml && !doc.graphXml.startsWith('<mxGraphModel')) {
    return { ...doc, graphXml: decompress(doc.graphXml), compressed: false };
  }
  return doc;
}

export function publishLoadedDiagram(doc: Diagram | undefined): Diagram {
  const diagram = normalizeCompressedGraphDoc(doc) ?? NULL_DIAGRAM;
  store.state.diagram = diagram;
  // Signal load completion (success OR failure — `doc` is undefined when the
  // referenced content 404s/failed to load). The embed viewer uses this to show
  // a terminal error rather than an endless "Loading embedded diagram…".
  store.state.diagramLoadComplete = true;
  window.diagram = diagram;
  console.log('loadDiagram - window.diagram', window.diagram);
  return diagram;
}

export async function bootstrapForgeViewer(options: ViewerBootstrapOptions): Promise<void> {
  try {
    await globals.apWrapper.initializeContext();
    const paywalled = await tryFullscreenViewerPaywall({
      doc: NULL_DIAGRAM,
      content: options.content,
      contentProps: options.contentProps,
      macroKind: options.macroKind,
    });

    // Content SWR stays disabled behind the fullscreen paywall and when the
    // caller has no custom-content id. Only its background revalidation is
    // shared with the sequence-family path.
    let customContentId: string | undefined;
    if (!paywalled) {
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
            void revalidateViewerContent({
              customContentId,
              cachedHash: cached.hash,
              loadFresh: () => renderPerf.time('fetch', () => options.loadDiagram()),
              onChanged: (fresh) => {
                renderPerf.markContentSource('fetch');
                publishLoadedDiagram(fresh);
              },
              afterFresh: (fresh) => options.afterLoad?.(fresh),
            });
            return; // rendered from cache — skip the live-fetch + mount path entirely
          } catch (e) {
            console.warn('[content-swr] cache hit failed to render; falling back to live fetch', e);
            // fall through to the normal fetch path below
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
    const doc = await renderPerf.time('fetch', () => options.loadDiagram());
    publishLoadedDiagram(doc);
    if (customContentId && doc) {
      // Prime the id-keyed SWR cache so a later viewer revisit can render
      // before the fetch. Cache the RAW fetched value (pre-normalization —
      // publishLoadedDiagram's normalizeCompressedGraphDoc runs on every
      // publish, cache hit included above) so its hash matches a future
      // fetch's raw value for change detection.
      putCachedContent(customContentId, JSON.stringify(doc));
      renderPerf.markContentSource('fetch');
    }
    await options.afterLoad?.(doc);
  } catch (error) {
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  }
}
