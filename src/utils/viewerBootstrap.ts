import { Component } from 'vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import store from '@/model/store2';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { decompress } from '@/utils/compress';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';

export interface ViewerBootstrapOptions {
  macroKind: MacroKind;
  content: Component;
  contentProps?: Record<string, unknown>;
  loadDiagram: () => Promise<Diagram | undefined>;
  afterLoad?: (doc: Diagram | undefined) => void | Promise<void>;
  onError?: (error: unknown) => void;
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
  window.diagram = diagram;
  console.log('loadDiagram - window.diagram', window.diagram);
  return diagram;
}

export async function bootstrapForgeViewer(options: ViewerBootstrapOptions): Promise<void> {
  try {
    await globals.apWrapper.initializeContext();
    trackAnalyticsEvent('macro_viewed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: options.macroKind,
      entry_point: 'page_view',
    });

    const paywalled = await tryFullscreenViewerPaywall({
      doc: NULL_DIAGRAM,
      content: options.content,
      contentProps: options.contentProps,
      macroKind: options.macroKind,
    });
    if (!paywalled) {
      mountRoot(NULL_DIAGRAM, options.content, options.contentProps);
    }

    const doc = await options.loadDiagram();
    publishLoadedDiagram(doc);
    await options.afterLoad?.(doc);
  } catch (error) {
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  }
}
